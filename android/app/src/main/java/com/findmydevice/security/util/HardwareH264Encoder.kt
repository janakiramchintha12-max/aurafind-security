package com.findmydevice.security.util

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.os.Bundle
import android.util.Log
import android.view.Surface
import kotlinx.coroutines.*
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Ultra-Low-Latency Hardware H.264 Encoder.
 * KEY OPTIMIZATIONS:
 * - KEY_LATENCY = 0: Zero encoder lookahead (no frame buffering).
 * - KEY_PRIORITY = 0: Realtime OS scheduling priority.
 * - vendor.rtc-ext.video.encoder.latency = 0: Qualcomm/MediaTek vendor flag.
 * - DEQUEUE_TIMEOUT_US = 0: Non-blocking drain poll — sub-ms output latency.
 * - CBR mode: Prevents bursty bitrate spikes that cause congestion/lag.
 * - AVCProfileBaseline: Lowest decode complexity = least viewer display latency.
 * - I-frame every 2s: Faster recovery for viewers joining mid-stream.
 * - Dedicated single-thread drain loop: Never shares IO pool with capture tasks.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class HardwareH264Encoder(
    private val width: Int = 1280,
    private val height: Int = 720,
    private val frameRate: Int = 30,
    private val bitRate: Int = 2_000_000,
    private val iFrameIntervalSeconds: Int = 2,
    private val onNalUnitEncoded: (data: ByteArray, isKeyFrame: Boolean, timestampUs: Long) -> Unit
) {
    companion object {
        private const val TAG = "HardwareH264Encoder"
        private const val MIME_TYPE = MediaFormat.MIMETYPE_VIDEO_AVC
        // 0L = non-blocking poll: drain loop immediately returns INFO_TRY_AGAIN_LATER
        // when no output is ready, then loops back. Sub-ms output latency, no sleep.
        private const val DEQUEUE_TIMEOUT_US = 0L
    }

    private var mediaCodec: MediaCodec? = null
    private var inputSurface: Surface? = null
    private val isRunning = AtomicBoolean(false)
    private var drainJob: Job? = null
    private val drainDispatcher = newSingleThreadContext("AuraFind-H264Drain")
    private val scope = CoroutineScope(drainDispatcher + SupervisorJob())
    private var spsPpsBytes: ByteArray? = null

    val surface: Surface?
        get() = inputSurface

    fun isEncoding(): Boolean = isRunning.get()

    fun start(): Surface? {
        if (isRunning.get()) return inputSurface
        try {
            val format = MediaFormat.createVideoFormat(MIME_TYPE, width, height).apply {
                setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
                setInteger(MediaFormat.KEY_BIT_RATE, bitRate)
                setInteger(MediaFormat.KEY_FRAME_RATE, frameRate)
                setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, iFrameIntervalSeconds)
                // Zero lookahead - frames are emitted immediately without batching
                setInteger(MediaFormat.KEY_LATENCY, 0)
                // Realtime priority - OS prefers this thread for encoding
                setInteger(MediaFormat.KEY_PRIORITY, 0)
                // Qualcomm/MediaTek vendor-specific zero-latency flag (no-op on unsupported chipsets)
                try { setInteger("vendor.rtc-ext.video.encoder.latency", 0) } catch (_: Exception) {}
                // Push repeated frame at the configured FPS cadence even on static screens
                try { setLong(MediaFormat.KEY_REPEAT_PREVIOUS_FRAME_AFTER, (1_000_000L / frameRate)) } catch (_: Exception) {}
                // CBR prevents traffic bursts that spike end-to-end latency
                try {
                    setInteger(MediaFormat.KEY_BITRATE_MODE, MediaCodecInfo.EncoderCapabilities.BITRATE_MODE_CBR)
                } catch (_: Exception) {
                    try { setInteger(MediaFormat.KEY_BITRATE_MODE, MediaCodecInfo.EncoderCapabilities.BITRATE_MODE_VBR) } catch (_: Exception) {}
                }
                // Baseline profile = fastest decode path on viewer side
                try {
                    setInteger(MediaFormat.KEY_PROFILE, MediaCodecInfo.CodecProfileLevel.AVCProfileBaseline)
                    setInteger(MediaFormat.KEY_LEVEL, MediaCodecInfo.CodecProfileLevel.AVCLevel31)
                } catch (_: Exception) {}
            }

            mediaCodec = MediaCodec.createEncoderByType(MIME_TYPE).apply {
                configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
                inputSurface = createInputSurface()
                start()
            }

            isRunning.set(true)
            startDrainLoop()
            Log.i(TAG, "[H264] Started ${width}x${height} @ ${frameRate}fps, ${bitRate/1000}kbps CBR, I=${iFrameIntervalSeconds}s")
            return inputSurface
        } catch (e: Exception) {
            Log.e(TAG, "[H264] Start failed: ${e.message}", e)
            stop()
            return null
        }
    }

    fun requestSyncFrame() {
        if (!isRunning.get()) return
        try {
            mediaCodec?.setParameters(Bundle().apply { putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0) })
        } catch (e: Exception) {
            Log.w(TAG, "[H264] Sync frame request failed: ${e.message}")
        }
    }

    private fun startDrainLoop() {
        drainJob = scope.launch {
            val bufferInfo = MediaCodec.BufferInfo()
            val streamOut = ByteArrayOutputStream(8192)
            while (isActive && isRunning.get()) {
                val codec = mediaCodec ?: break
                try {
                    val outputIndex = codec.dequeueOutputBuffer(bufferInfo, DEQUEUE_TIMEOUT_US)
                    when {
                        outputIndex >= 0 -> {
                            val outputBuffer: ByteBuffer = codec.getOutputBuffer(outputIndex) ?: run {
                                codec.releaseOutputBuffer(outputIndex, false); return@run null
                            } ?: continue
                            outputBuffer.position(bufferInfo.offset)
                            outputBuffer.limit(bufferInfo.offset + bufferInfo.size)
                            val isConfig = (bufferInfo.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0
                            val isKeyFrame = (bufferInfo.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME) != 0
                            if (bufferInfo.size > 0) {
                                val chunk = ByteArray(bufferInfo.size)
                                outputBuffer.get(chunk)
                                if (isConfig) {
                                    if (spsPpsBytes == null) {
                                        spsPpsBytes = chunk.clone()
                                    } else if (!spsPpsBytes!!.contentEquals(chunk)) {
                                        val combined = ByteArrayOutputStream()
                                        combined.write(spsPpsBytes!!)
                                        combined.write(chunk)
                                        spsPpsBytes = combined.toByteArray()
                                    }
                                } else {
                                    streamOut.reset()
                                    if (isKeyFrame && spsPpsBytes != null) streamOut.write(spsPpsBytes!!)
                                    streamOut.write(chunk)
                                    val payload = streamOut.toByteArray()
                                    if (payload.isNotEmpty()) {
                                        onNalUnitEncoded(payload, isKeyFrame, bufferInfo.presentationTimeUs)
                                    }
                                }
                            }
                            codec.releaseOutputBuffer(outputIndex, false)
                            if ((bufferInfo.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) break
                        }
                        outputIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                            val newFormat = codec.outputFormat
                            val csd0 = newFormat.getByteBuffer("csd-0")
                            val csd1 = newFormat.getByteBuffer("csd-1")
                            if (csd0 != null && csd1 != null) {
                                val hdr = ByteArrayOutputStream()
                                hdr.write(ByteArray(csd0.remaining()).also { csd0.get(it) })
                                hdr.write(ByteArray(csd1.remaining()).also { csd1.get(it) })
                                spsPpsBytes = hdr.toByteArray()
                                Log.i(TAG, "[H264] SPS/PPS updated (${spsPpsBytes!!.size}B)")
                            }
                        }
                    }
                } catch (e: Exception) {
                    if (isRunning.get()) Log.e(TAG, "[H264] Drain error: ${e.message}")
                }
            }
        }
    }

    fun stop() {
        isRunning.set(false)
        drainJob?.cancel(); drainJob = null
        try { mediaCodec?.stop() } catch (_: Exception) {}
        try { mediaCodec?.release() } catch (_: Exception) {}
        mediaCodec = null
        try { inputSurface?.release() } catch (_: Exception) {}
        inputSurface = null
        spsPpsBytes = null
        Log.i(TAG, "[H264] Stopped.")
    }
}
