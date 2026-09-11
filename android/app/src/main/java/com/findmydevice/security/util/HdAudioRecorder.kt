package com.findmydevice.security.util

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import android.util.Base64
import android.util.Log
import com.findmydevice.security.data.network.ApiService
import com.findmydevice.security.data.network.AudioRecordingUploadRequest
import kotlinx.coroutines.*
import java.io.File

/**
 * HD Audio Recording Engine for Android.
 * Records crystal clear 44.1kHz AAC voice audio from hardware microphone and uploads to cloud backend.
 * Supports extended durations up to 3 hours (10,800s) as well as manual on-demand Start/Stop controls.
 */
object HdAudioRecorder {

    private const val TAG = "HdAudioRecorder"
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private var isRecording = false
    private var recordingStartTime = 0L
    private var mediaRecorder: MediaRecorder? = null
    private var recordingFile: File? = null
    private var activeDurationSeconds: Int = 10
    private var autoStopJob: Job? = null

    fun isCurrentlyRecording(): Boolean = isRecording

    /**
     * Records audio for a specified duration (up to 10,800s / 3 hours) and uploads to cloud backend.
     */
    fun recordAndUpload(
        context: Context,
        apiService: ApiService,
        deviceId: String,
        deviceToken: String,
        durationSeconds: Int = 10
    ) {
        // Clamp between 5s and 10,800s (3 hours)
        val clampedDuration = durationSeconds.coerceIn(5, 10800)
        startRecording(context, apiService, deviceId, deviceToken, clampedDuration)
    }

    /**
     * Starts continuous or timed HD audio recording (max 3 hours auto-safeguard).
     */
    fun startRecording(
        context: Context,
        apiService: ApiService,
        deviceId: String,
        deviceToken: String,
        maxDurationSeconds: Int = 10800 // Default 3 hours max
    ) {
        if (isRecording) {
            Log.w(TAG, "Audio recording is already in progress")
            return
        }

        if (PrivacyManager.isMicPaused(context)) {
            Log.w(TAG, "Cannot start audio recording: Microphone access paused by device user")
            return
        }

        activeDurationSeconds = maxDurationSeconds.coerceIn(5, 10800)
        recordingStartTime = System.currentTimeMillis()

        scope.launch {
            val outputFile = File(context.cacheDir, "hd_audio_${System.currentTimeMillis()}.m4a")
            recordingFile = outputFile
            var recorder: MediaRecorder? = null

            try {
                recorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    MediaRecorder(context)
                } else {
                    @Suppress("DEPRECATION")
                    MediaRecorder()
                }
                mediaRecorder = recorder

                recorder.setAudioSource(MediaRecorder.AudioSource.MIC)
                recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                recorder.setAudioEncodingBitRate(96000) // 96 kbps high-efficiency crystal-clear voice
                recorder.setAudioSamplingRate(44100) // 44.1 kHz Studio Sampling Rate
                recorder.setOutputFile(outputFile.absolutePath)

                recorder.prepare()
                recorder.start()
                isRecording = true
                Log.i(TAG, "Started HD Audio Recording (Max ${activeDurationSeconds}s / 3h limit)")

                // Schedule auto-stop when duration reaches max
                autoStopJob = scope.launch {
                    delay(activeDurationSeconds * 1000L)
                    if (isRecording) {
                        Log.i(TAG, "Max recording duration reached ($activeDurationSeconds s), auto-stopping...")
                        stopRecording(apiService, deviceId, deviceToken)
                    }
                }

            } catch (e: Exception) {
                Log.e(TAG, "Error initializing HD audio recording", e)
                cleanup()
            }
        }
    }

    /**
     * Stops an active audio recording on-demand, finalizes the audio file, and uploads to cloud backend.
     */
    fun stopRecording(
        apiService: ApiService,
        deviceId: String,
        deviceToken: String
    ) {
        if (!isRecording && mediaRecorder == null) {
            Log.w(TAG, "No audio recording currently active to stop")
            return
        }

        autoStopJob?.cancel()
        autoStopJob = null
        isRecording = false

        val elapsedMs = System.currentTimeMillis() - recordingStartTime
        val durationSecs = Math.max(1f, (elapsedMs / 1000f))
        val targetFile = recordingFile

        scope.launch {
            try {
                try {
                    mediaRecorder?.stop()
                } catch (e: Exception) {
                    Log.e(TAG, "Error stopping MediaRecorder: ${e.message}")
                }

                cleanup()
                delay(150L) // Ensure OS file system flushes audio track headers

                if (targetFile != null && targetFile.exists() && targetFile.length() > 0) {
                    Log.i(TAG, "Finalizing HD audio file: ${targetFile.length()} bytes, duration: ${durationSecs}s")

                    val bytes = targetFile.readBytes()
                    val base64Data = "data:audio/mp4;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)

                    // Upload with automatic retry loop (up to 3 attempts)
                    var uploadSuccess = false
                    var attempt = 0
                    while (!uploadSuccess && attempt < 3) {
                        attempt++
                        try {
                            val response = apiService.uploadAudioRecording(
                                deviceId = deviceId,
                                deviceToken = deviceToken,
                                request = AudioRecordingUploadRequest(
                                    audio_data = base64Data,
                                    mime_type = "audio/mp4",
                                    duration_seconds = durationSecs
                                )
                            )
                            if (response.isSuccessful) {
                                uploadSuccess = true
                                Log.i(TAG, "HD Audio recording uploaded successfully (${durationSecs}s) on attempt $attempt")
                            } else {
                                Log.e(TAG, "Audio upload attempt $attempt failed with code ${response.code()}: ${response.errorBody()?.string()}")
                                delay(1000L * attempt)
                            }
                        } catch (uploadErr: Exception) {
                            Log.e(TAG, "Audio upload network error on attempt $attempt: ${uploadErr.message}")
                            delay(1000L * attempt)
                        }
                    }
                } else {
                    Log.w(TAG, "Target audio recording file is empty or missing")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error finalizing and uploading HD audio recording", e)
            } finally {
                targetFile?.delete()
                recordingFile = null
            }
        }
    }

    private fun cleanup() {
        try {
            mediaRecorder?.release()
        } catch (e: Exception) {}
        mediaRecorder = null
        isRecording = false
    }
}
