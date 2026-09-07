package com.findmydevice.security.util

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import android.util.Base64
import android.util.Log
import com.findmydevice.security.data.network.ApiService
import com.findmydevice.security.data.network.AudioRecordingUploadRequest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.File

/**
 * HD Audio Recording Engine for Android.
 * Records crystal clear 44.1kHz AAC voice audio from hardware microphone and uploads to cloud backend.
 */
object HdAudioRecorder {

    private val scope = CoroutineScope(Dispatchers.IO)
    private var isRecording = false

    fun isCurrentlyRecording(): Boolean = isRecording

    fun recordAndUpload(
        context: Context,
        apiService: ApiService,
        deviceId: String,
        deviceToken: String,
        durationSeconds: Int = 10
    ) {
        if (isRecording) {
            Log.w("HdAudioRecorder", "Recording already in progress, skipping request")
            return
        }
        isRecording = true

        scope.launch {
            val outputFile = File(context.cacheDir, "hd_audio_${System.currentTimeMillis()}.m4a")
            var recorder: MediaRecorder? = null
            try {
                recorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    MediaRecorder(context)
                } else {
                    @Suppress("DEPRECATION")
                    MediaRecorder()
                }

                recorder.setAudioSource(MediaRecorder.AudioSource.MIC)
                recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                recorder.setAudioEncodingBitRate(128000) // 128 kbps HD Voice
                recorder.setAudioSamplingRate(44100) // 44.1 kHz Crystal Clear
                recorder.setOutputFile(outputFile.absolutePath)

                recorder.prepare()
                recorder.start()
                Log.i("HdAudioRecorder", "Started HD Audio Recording for ${durationSeconds}s")

                // Wait for requested duration
                delay(durationSeconds * 1000L)

                recorder.stop()
                recorder.release()
                recorder = null
                Log.i("HdAudioRecorder", "Finished HD Audio Recording. File size: ${outputFile.length()} bytes")

                if (outputFile.exists() && outputFile.length() > 0) {
                    val bytes = outputFile.readBytes()
                    val base64Data = "data:audio/mp4;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)

                    val response = apiService.uploadAudioRecording(
                        deviceId = deviceId,
                        deviceToken = deviceToken,
                        request = AudioRecordingUploadRequest(
                            audio_data = base64Data,
                            mime_type = "audio/mp4",
                            duration_seconds = durationSeconds.toFloat()
                        )
                    )
                    Log.i("HdAudioRecorder", "HD Audio clip uploaded to cloud: ${response.isSuccessful}")
                }
            } catch (e: Exception) {
                Log.e("HdAudioRecorder", "Error during HD audio recording", e)
            } finally {
                try {
                    recorder?.release()
                } catch (e: Exception) {}
                outputFile.delete()
                isRecording = false
            }
        }
    }
}
