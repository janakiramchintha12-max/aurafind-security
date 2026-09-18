package com.findmydevice.security.util

import android.content.Context
import android.media.*
import android.util.Base64
import android.util.Log
import com.findmydevice.security.data.network.ApiService
import kotlinx.coroutines.*
import java.util.concurrent.atomic.AtomicBoolean

/**
 * High-performance bidirectional VoIP Intercom engine for Android.
 * Complies fully with Android microphone privacy and foreground service standards.
 */
object VoiceCallManager {

    private const val TAG = "VoiceCallManager"
    private var isCallActive = false
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private var audioRecord: AudioRecord? = null
    private var audioTrack: AudioTrack? = null
    private var isRecording = AtomicBoolean(false)
    private var recordJob: Job? = null
    private var pollIncomingJob: Job? = null

    private const val SAMPLE_RATE = 16000 // 16kHz HD Voice
    private const val CHANNEL_IN = AudioFormat.CHANNEL_IN_MONO
    private const val CHANNEL_OUT = AudioFormat.CHANNEL_OUT_MONO
    private const val AUDIO_FORMAT = AudioFormat.ENCODING_PCM_16BIT

    fun isCallRunning(): Boolean = isCallActive

    fun startCall(
        context: Context,
        apiService: ApiService,
        deviceId: String,
        deviceToken: String
    ): Boolean {
        if (isCallActive) return true
        if (PrivacyManager.isMicPaused(context) && PrivacyManager.isSpeakerPaused(context)) {
            Log.w(TAG, "Voice call blocked: microphone and speaker are paused")
            return false
        }

        val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
        audioManager.isSpeakerphoneOn = true

        var started = false
        if (!PrivacyManager.isMicPaused(context)) {
            started = startMicrophoneCapture(apiService, deviceId, deviceToken) || started
        }
        if (!PrivacyManager.isSpeakerPaused(context)) {
            started = startSpeakerPlayback(apiService, deviceId, deviceToken) || started
        }
        isCallActive = started
        Log.i(TAG, "Voice call ${if (started) "started" else "failed to start"}")
        return started
    }

    fun stopCall() {
        isCallActive = false
        isRecording.set(false)

        recordJob?.cancel()
        pollIncomingJob?.cancel()

        try {
            audioRecord?.stop()
            audioRecord?.release()
            audioRecord = null
        } catch (e: Exception) {
            e.printStackTrace()
        }

        try {
            audioTrack?.stop()
            audioTrack?.release()
            audioTrack = null
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun startMicrophoneCapture(apiService: ApiService, deviceId: String, deviceToken: String): Boolean {
        val minBufferSize = AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL_IN, AUDIO_FORMAT)
        val bufferSize = Math.max(minBufferSize, 2048)

        try {
            audioRecord = AudioRecord(
                MediaRecorder.AudioSource.VOICE_COMMUNICATION,
                SAMPLE_RATE,
                CHANNEL_IN,
                AUDIO_FORMAT,
                bufferSize
            )

            if (audioRecord?.state != AudioRecord.STATE_INITIALIZED) {
                Log.e(TAG, "AudioRecord failed to initialize")
                return false
            }

            audioRecord?.startRecording()
            isRecording.set(true)

            recordJob = scope.launch {
                val buffer = ByteArray(1024)
                while (isActive && isRecording.get()) {
                    val read = audioRecord?.read(buffer, 0, buffer.size) ?: 0
                    if (read > 0) {
                        val base64Chunk = Base64.encodeToString(buffer.copyOf(read), Base64.NO_WRAP)
                        try {
                            apiService.pushAudioChunk(
                                deviceId = deviceId,
                                deviceToken = deviceToken,
                                request = mapOf("audio_data" to base64Chunk, "direction" to "DEVICE_TO_DASHBOARD")
                            )
                        } catch (e: Exception) {
                            Log.w(TAG, "Microphone upload failed: ${e.message}")
                        }
                    }
                    delay(40L) // ~25 packets per sec for ultra-low latency voice
                }
            }
        } catch (e: SecurityException) {
            Log.e(TAG, "Microphone permission denied", e)
            return false
        } catch (e: Exception) {
            Log.e(TAG, "Microphone capture failed", e)
            return false
        }
        return true
    }

    private fun startSpeakerPlayback(apiService: ApiService, deviceId: String, deviceToken: String): Boolean {
        val minBufferSize = AudioTrack.getMinBufferSize(SAMPLE_RATE, CHANNEL_OUT, AUDIO_FORMAT)
        val bufferSize = Math.max(minBufferSize, 2048)

        try {
            audioTrack = AudioTrack(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
                AudioFormat.Builder()
                    .setSampleRate(SAMPLE_RATE)
                    .setChannelMask(CHANNEL_OUT)
                    .setEncoding(AUDIO_FORMAT)
                    .build(),
                bufferSize,
                AudioTrack.MODE_STREAM,
                AudioManager.AUDIO_SESSION_ID_GENERATE
            )

            audioTrack?.play()

            pollIncomingJob = scope.launch {
                while (isActive && isCallActive) {
                    try {
                        val res = apiService.pollIncomingAudio(deviceId, deviceToken)
                        if (res.isSuccessful) {
                            val chunks = res.body() ?: emptyList()
                            for (chunk in chunks) {
                                val bytes = Base64.decode(chunk, Base64.DEFAULT)
                                if (bytes.isNotEmpty()) {
                                    audioTrack?.write(bytes, 0, bytes.size)
                                }
                            }
                        }
                    } catch (e: Exception) {
                        Log.w(TAG, "Speaker polling failed: ${e.message}")
                    }
                    delay(50L)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Speaker playback failed", e)
            return false
        }
        return true
    }
}
