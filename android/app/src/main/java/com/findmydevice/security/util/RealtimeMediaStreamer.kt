package com.findmydevice.security.util

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.hardware.camera2.*
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.*
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Handler
import android.os.HandlerThread
import android.os.Process
import android.util.DisplayMetrics
import android.util.Log
import android.view.Surface
import android.view.WindowManager
import kotlinx.coroutines.*
import okhttp3.*
import okio.ByteString.Companion.toByteString
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * AuraFind Ultra-Low-Latency Binary WebSocket Media Streamer.
 *
 * KEY OPTIMIZATIONS vs. original:
 * 1. OkHttpClient: connectTimeout=4s, writeTimeout=0 (fire-and-forget, non-blocking),
 *    readTimeout=0, pingInterval=5s for fast disconnect detection.
 * 2. Audio: 48kHz / PCM16 / MONO / 512-sample (1024-byte) chunks.
 *    No delay() sleep — AudioRecord.read() blocks precisely for chunk duration.
 *    VOICE_COMMUNICATION source enables hardware AEC/noise suppression.
 *    Process.THREAD_PRIORITY_URGENT_AUDIO for minimal scheduling jitter.
 * 3. Camera: TEMPLATE_RECORD + AE_TARGET_FPS_RANGE locked to [30,30].
 *    HandlerThread at THREAD_PRIORITY_DISPLAY priority.
 * 4. Screen: 720p CBR 2Mbps, VirtualDisplay fed directly into encoder surface.
 * 5. On WebSocket reconnect, immediately requests IDR keyframe from both encoders.
 */
object RealtimeMediaStreamer {

    private const val TAG = "RealtimeStreamer"

    private const val PKT_VIDEO: Byte           = 0x01
    private const val PKT_AUDIO: Byte           = 0x02
    private const val PKT_CONTROL: Byte         = 0x03
    private const val PKT_DASHBOARD_AUDIO: Byte = 0x04

    private const val SRC_SCREEN: Byte    = 0x01
    private const val SRC_CAM_FRONT: Byte = 0x02
    private const val SRC_CAM_BACK: Byte  = 0x03
    private const val SRC_MIC: Byte       = 0x04

    // 48kHz avoids SRC resampling on most Android HALs (+5ms saved vs 16kHz->48kHz conversion)
    private const val AUDIO_SAMPLE_RATE   = 48_000
    // 512 samples = 10.67ms @ 48kHz; matches Opus 10ms frame granularity
    private const val AUDIO_CHUNK_SAMPLES = 512
    private const val AUDIO_CHUNK_BYTES   = AUDIO_CHUNK_SAMPLES * 2  // PCM16 = 2 bytes/sample

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val isWsConnected = AtomicBoolean(false)
    private var webSocket: WebSocket? = null
    private var okHttpClient: OkHttpClient? = null

    private var screenEncoder: HardwareH264Encoder? = null
    private var screenVirtualDisplay: VirtualDisplay? = null
    private var screenMediaProjection: MediaProjection? = null
    private val isScreenMirroring = AtomicBoolean(false)
    private var screenBgThread: HandlerThread? = null
    private var screenBgHandler: Handler? = null

    private var cameraEncoder: HardwareH264Encoder? = null
    private var cameraDevice: CameraDevice? = null
    private var cameraCaptureSession: CameraCaptureSession? = null
    private var currentCameraFacing: String = "FRONT"
    private val isCameraStreaming = AtomicBoolean(false)
    private var cameraBgThread: HandlerThread? = null
    private var cameraBgHandler: Handler? = null

    private var audioRecord: AudioRecord? = null
    private var audioTrack: AudioTrack? = null
    private val isAudioStreaming = AtomicBoolean(false)
    private var audioJob: Job? = null

    private var cachedProjectionResultCode: Int = 0
    private var cachedProjectionResultData: Intent? = null

    fun setProjectionIntent(resultCode: Int, data: Intent) {
        cachedProjectionResultCode = resultCode
        cachedProjectionResultData = data
        Log.i(TAG, "Screen Capture token cached.")
    }

    fun isProjectionPermissionCached(): Boolean =
        cachedProjectionResultData != null || screenMediaProjection != null

    fun isScreenMirrorActive(): Boolean = isScreenMirroring.get()
    fun isCameraStreamActive(): Boolean  = isCameraStreaming.get()
    fun isAudioStreamActive(): Boolean   = isAudioStreaming.get()

    private fun ensureWebSocketConnected(deviceId: String, deviceToken: String) {
        if (isWsConnected.get() && webSocket != null) return
        val wsUrl = "${NetworkUtils.BASE_URL
            .replace("http://", "ws://")
            .replace("https://", "wss://")}api/v1/stream/ws?device_id=$deviceId&device_token=$deviceToken"
        if (okHttpClient == null) {
            okHttpClient = OkHttpClient.Builder()
                .connectTimeout(4, TimeUnit.SECONDS)
                .writeTimeout(0, TimeUnit.MILLISECONDS)  // non-blocking send
                .readTimeout(0, TimeUnit.MILLISECONDS)
                .pingInterval(5, TimeUnit.SECONDS)       // fast disconnect detection
                .retryOnConnectionFailure(true)
                .build()
        }
        val request = Request.Builder().url(wsUrl).build()
        webSocket = okHttpClient?.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                isWsConnected.set(true)
                Log.i(TAG, "[WS] Binary stream connected.")
                // Force an immediate keyframe so the viewer gets video right away
                screenEncoder?.requestSyncFrame()
                cameraEncoder?.requestSyncFrame()
            }
            override fun onMessage(ws: WebSocket, bytes: okio.ByteString) {
                handleIncomingBinaryPacket(bytes.toByteArray())
            }
            override fun onClosing(ws: WebSocket, code: Int, reason: String) {
                isWsConnected.set(false)
            }
            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                isWsConnected.set(false); webSocket = null
            }
            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                isWsConnected.set(false); webSocket = null
                Log.w(TAG, "[WS] Disconnected: ${t.message}")
            }
        })
    }

    private fun sendBinaryPacket(packetType: Byte, sourceId: Byte, timestampUs: Long, payload: ByteArray) {
        val ws = webSocket
        if (ws == null || !isWsConnected.get() || payload.isEmpty()) return
        val packet = ByteBuffer.allocate(10 + payload.size).order(ByteOrder.BIG_ENDIAN).apply {
            put(packetType); put(sourceId); putLong(timestampUs); put(payload)
        }.array()
        ws.send(packet.toByteString())
    }

    private fun handleIncomingBinaryPacket(data: ByteArray) {
        if (data.size < 10) return
        if (data[0] == PKT_DASHBOARD_AUDIO) {
            val audio = ByteArray(data.size - 10)
            System.arraycopy(data, 10, audio, 0, audio.size)
            playDuplexAudio(audio)
        }
    }

    // ── SCREEN MIRROR ─────────────────────────────────────────────────────────

    @SuppressLint("WrongConstant")
    fun startScreenMirrorStream(
        context: Context, deviceId: String, deviceToken: String,
        targetWidth: Int = 720, targetHeight: Int = 1280
    ) {
        if (isScreenMirroring.get()) return
        if (PrivacyManager.isControlsRestricted(context)) return
        if (screenMediaProjection == null && cachedProjectionResultData == null) {
            context.startActivity(
                Intent(context, com.findmydevice.security.ui.ScreenCapturePermissionActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            ); return
        }
        ensureWebSocketConnected(deviceId, deviceToken)
        startScreenBgThread()
        try {
            val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
            val metrics = DisplayMetrics()
            @Suppress("DEPRECATION") wm.defaultDisplay.getRealMetrics(metrics)
            val aspect = metrics.heightPixels.toFloat() / metrics.widthPixels.toFloat()
            val encWidth = 720
            var encHeight = (720 * aspect).toInt().let { if (it % 2 != 0) it + 1 else it }
            screenEncoder = HardwareH264Encoder(
                width = encWidth, height = encHeight,
                frameRate = 30, bitRate = 2_000_000, iFrameIntervalSeconds = 2
            ) { nalBytes, _, timestampUs -> sendBinaryPacket(PKT_VIDEO, SRC_SCREEN, timestampUs, nalBytes) }
            val encoderSurface = screenEncoder?.start() ?: run { stopScreenMirrorStream(); return }
            if (screenMediaProjection == null && cachedProjectionResultData != null) {
                val pm = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
                screenMediaProjection = pm.getMediaProjection(cachedProjectionResultCode, cachedProjectionResultData!!.clone() as Intent)
                screenMediaProjection?.registerCallback(object : MediaProjection.Callback() {
                    override fun onStop() { screenMediaProjection = null; cachedProjectionResultData = null; stopScreenMirrorStream() }
                }, screenBgHandler)
            }
            screenVirtualDisplay = screenMediaProjection?.createVirtualDisplay(
                "AuraFindScreenHW", encWidth, encHeight, metrics.densityDpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, encoderSurface,
                object : VirtualDisplay.Callback() {
                    override fun onPaused()  {}
                    override fun onResumed() {}
                    override fun onStopped() {}
                }, screenBgHandler
            )
            isScreenMirroring.set(true)
            Log.i(TAG, "[Screen] HW mirror active: ${encWidth}x${encHeight} @ 30fps, 2Mbps CBR")
        } catch (e: Exception) {
            Log.e(TAG, "[Screen] Start error: ${e.message}", e); stopScreenMirrorStream()
        }
    }

    fun stopScreenMirrorStream() {
        isScreenMirroring.set(false)
        try { screenVirtualDisplay?.release() } catch (_: Exception) {}
        screenVirtualDisplay = null
        screenEncoder?.stop(); screenEncoder = null
        stopScreenBgThread()
    }

    private fun startScreenBgThread() {
        if (screenBgThread == null) {
            screenBgThread = HandlerThread("AuraFind-ScreenHW", Process.THREAD_PRIORITY_DISPLAY).also { it.start() }
            screenBgHandler = Handler(screenBgThread!!.looper)
        }
    }

    private fun stopScreenBgThread() {
        screenBgThread?.quitSafely(); try { screenBgThread?.join(500) } catch (_: Exception) {}
        screenBgThread = null; screenBgHandler = null
    }

    // ── CAMERA ────────────────────────────────────────────────────────────────

    @SuppressLint("MissingPermission")
    fun startCameraStream(
        context: Context, deviceId: String, deviceToken: String,
        facing: String = "FRONT", width: Int = 1280, height: Int = 720
    ) {
        if (PrivacyManager.isCameraPaused(context)) return
        currentCameraFacing = facing.uppercase()
        ensureWebSocketConnected(deviceId, deviceToken)
        startCameraBgThread()
        try {
            val cameraManager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
            val targetFacing = if (currentCameraFacing == "BACK") CameraCharacteristics.LENS_FACING_BACK else CameraCharacteristics.LENS_FACING_FRONT
            val pair = CameraStreamManager.findCameraIdForFacing(cameraManager, targetFacing) ?: return
            val targetCameraId = pair.first
            val characteristics = pair.second
            val sourceId = if (currentCameraFacing == "BACK") SRC_CAM_BACK else SRC_CAM_FRONT
            cameraEncoder = HardwareH264Encoder(
                width = width, height = height,
                frameRate = 30, bitRate = 2_000_000, iFrameIntervalSeconds = 2
            ) { nalBytes, _, timestampUs -> sendBinaryPacket(PKT_VIDEO, sourceId, timestampUs, nalBytes) }
            val surface = cameraEncoder?.start() ?: return
            cameraManager.openCamera(targetCameraId, object : CameraDevice.StateCallback() {
                override fun onOpened(camera: CameraDevice) {
                    cameraDevice = camera
                    try {
                        camera.createCaptureSession(listOf(surface), object : CameraCaptureSession.StateCallback() {
                            override fun onConfigured(session: CameraCaptureSession) {
                                cameraCaptureSession = session
                                try {
                                    val req = camera.createCaptureRequest(CameraDevice.TEMPLATE_RECORD).apply {
                                        addTarget(surface)
                                        set(CaptureRequest.CONTROL_MODE, CameraMetadata.CONTROL_MODE_AUTO)
                                        // Lock FPS to [30,30] - prevents AE algorithm from dropping to 15fps in low light
                                        val ranges = characteristics.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_TARGET_FPS_RANGES) ?: emptyArray()
                                        val preferred = ranges.firstOrNull { it.lower == 30 && it.upper == 30 } ?: ranges.maxByOrNull { it.upper }
                                        if (preferred != null) set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, preferred)
                                    }
                                    session.setRepeatingRequest(req.build(), null, cameraBgHandler)
                                    isCameraStreaming.set(true)
                                    Log.i(TAG, "[Camera] HW stream active: $currentCameraFacing @ 30fps, 2Mbps CBR")
                                } catch (e: Exception) { Log.e(TAG, "[Camera] Request error: ${e.message}") }
                            }
                            override fun onConfigureFailed(session: CameraCaptureSession) { stopCameraStream() }
                        }, cameraBgHandler)
                    } catch (e: Exception) { Log.e(TAG, "[Camera] Session error: ${e.message}") }
                }
                override fun onDisconnected(camera: CameraDevice) { camera.close(); cameraDevice = null }
                override fun onError(camera: CameraDevice, error: Int) { camera.close(); cameraDevice = null }
            }, cameraBgHandler)
        } catch (e: Exception) { Log.e(TAG, "[Camera] Open error: ${e.message}", e); stopCameraStream() }
    }

    fun stopCameraStream() {
        isCameraStreaming.set(false)
        try { cameraCaptureSession?.stopRepeating(); cameraCaptureSession?.close() } catch (_: Exception) {}
        cameraCaptureSession = null
        try { cameraDevice?.close() } catch (_: Exception) {}
        cameraDevice = null
        cameraEncoder?.stop(); cameraEncoder = null
        stopCameraBgThread()
    }

    private fun startCameraBgThread() {
        if (cameraBgThread == null) {
            cameraBgThread = HandlerThread("AuraFind-CamHW", Process.THREAD_PRIORITY_DISPLAY).also { it.start() }
            cameraBgHandler = Handler(cameraBgThread!!.looper)
        }
    }

    private fun stopCameraBgThread() {
        cameraBgThread?.quitSafely(); try { cameraBgThread?.join(500) } catch (_: Exception) {}
        cameraBgThread = null; cameraBgHandler = null
    }

    // ── AUDIO ─────────────────────────────────────────────────────────────────

    @SuppressLint("MissingPermission")
    fun startAudioStream(context: Context, deviceId: String, deviceToken: String) {
        if (isAudioStreaming.get()) return
        if (PrivacyManager.isMicPaused(context)) return
        ensureWebSocketConnected(deviceId, deviceToken)
        val channelConfig  = AudioFormat.CHANNEL_IN_MONO
        val encoding       = AudioFormat.ENCODING_PCM_16BIT
        val hwMinBuffer    = AudioRecord.getMinBufferSize(AUDIO_SAMPLE_RATE, channelConfig, encoding)
        val recBufferSize  = maxOf(hwMinBuffer, AUDIO_CHUNK_BYTES * 4)
        try {
            audioRecord = AudioRecord(
                MediaRecorder.AudioSource.VOICE_COMMUNICATION,  // enables hardware AEC
                AUDIO_SAMPLE_RATE, channelConfig, encoding, recBufferSize
            )
            if (audioRecord?.state != AudioRecord.STATE_INITIALIZED) {
                Log.e(TAG, "[Audio] AudioRecord init failed"); return
            }
            audioRecord?.startRecording()
            isAudioStreaming.set(true)
            audioJob = scope.launch(Dispatchers.IO) {
                Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
                val pcmBuffer = ByteArray(AUDIO_CHUNK_BYTES)
                while (isActive && isAudioStreaming.get()) {
                    // AudioRecord.read() is a precise blocking call - no delay() needed
                    val read = audioRecord?.read(pcmBuffer, 0, AUDIO_CHUNK_BYTES) ?: break
                    if (read > 0) {
                        val ts = System.nanoTime() / 1000L
                        sendBinaryPacket(PKT_AUDIO, SRC_MIC, ts,
                            if (read == AUDIO_CHUNK_BYTES) pcmBuffer else pcmBuffer.copyOf(read))
                    }
                }
            }
            Log.i(TAG, "[Audio] Stream active: ${AUDIO_SAMPLE_RATE}Hz PCM16 mono, ${AUDIO_CHUNK_SAMPLES} samples/chunk")
        } catch (e: Exception) { Log.e(TAG, "[Audio] Start error: ${e.message}", e); stopAudioStream() }
    }

    fun stopAudioStream() {
        isAudioStreaming.set(false)
        audioJob?.cancel(); audioJob = null
        try { audioRecord?.stop(); audioRecord?.release() } catch (_: Exception) {}
        audioRecord = null
    }

    private fun playDuplexAudio(pcmBytes: ByteArray) {
        if (audioTrack == null) {
            val minBuf = AudioTrack.getMinBufferSize(AUDIO_SAMPLE_RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
            audioTrack = AudioTrack(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
                AudioFormat.Builder()
                    .setSampleRate(AUDIO_SAMPLE_RATE)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .build(),
                minBuf, AudioTrack.MODE_STREAM, AudioManager.AUDIO_SESSION_ID_GENERATE
            ).apply { play() }
        }
        try { audioTrack?.write(pcmBytes, 0, pcmBytes.size) } catch (_: Exception) {}
    }

    fun stopAllStreams() {
        stopScreenMirrorStream(); stopCameraStream(); stopAudioStream()
        try { audioTrack?.stop(); audioTrack?.release() } catch (_: Exception) {}
        audioTrack = null
        try { webSocket?.close(1000, "streams stopped") } catch (_: Exception) {}
        webSocket = null; isWsConnected.set(false)
    }
}
