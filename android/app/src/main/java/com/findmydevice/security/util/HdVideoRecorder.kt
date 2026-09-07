package com.findmydevice.security.util

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.hardware.camera2.*
import android.media.MediaMetadataRetriever
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.util.Base64
import android.util.Log
import android.util.Size
import com.findmydevice.security.data.network.ApiService
import com.findmydevice.security.data.network.VideoRecordingUploadRequest
import kotlinx.coroutines.*
import java.io.ByteArrayOutputStream
import java.io.File

/**
 * HD Video & Audio Recording Engine for Android.
 * Records crystal-clear 1080p/720p H.264 video synchronized with 44.1kHz AAC stereo audio from hardware microphone.
 * Supports on-demand Start and Stop remote commands.
 */
object HdVideoRecorder {

    private const val TAG = "HdVideoRecorder"

    private var isRecording = false
    private var recordingStartTime = 0L
    private var recordingFacing = "FRONT"
    private var recordingFile: File? = null

    private var mediaRecorder: MediaRecorder? = null
    private var cameraDevice: CameraDevice? = null
    private var captureSession: CameraCaptureSession? = null
    private var backgroundThread: HandlerThread? = null
    private var backgroundHandler: Handler? = null

    private var autoStopJob: Job? = null
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    fun isCurrentlyRecording(): Boolean = isRecording
    fun getRecordingFacing(): String = recordingFacing

    @SuppressLint("MissingPermission")
    fun startRecording(
        context: Context,
        apiService: ApiService,
        deviceId: String,
        deviceToken: String,
        facing: String = "FRONT",
        maxDurationSeconds: Int = 300 // Max 5 minutes auto-stop safeguard
    ) {
        if (isRecording) {
            Log.w(TAG, "Video recording is already active")
            return
        }

        if (PrivacyManager.isCameraPaused(context) || PrivacyManager.isMicPaused(context)) {
            Log.w(TAG, "Cannot start video recording: Camera or Microphone is paused by device user")
            return
        }

        // Stop live streaming if active so camera hardware is free
        CameraStreamManager.stopStreaming()

        recordingFacing = facing.uppercase()
        isRecording = true
        recordingStartTime = System.currentTimeMillis()

        scope.launch {
            try {
                startBackgroundThread()

                val cameraManager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
                val targetFacing = if (recordingFacing == "BACK") CameraCharacteristics.LENS_FACING_BACK else CameraCharacteristics.LENS_FACING_FRONT

                var targetCameraId: String? = null
                var cameraCharacteristics: CameraCharacteristics? = null

                for (id in cameraManager.cameraIdList) {
                    val characteristics = cameraManager.getCameraCharacteristics(id)
                    val lensFacing = characteristics.get(CameraCharacteristics.LENS_FACING)
                    if (lensFacing == targetFacing) {
                        targetCameraId = id
                        cameraCharacteristics = characteristics
                        break
                    }
                }

                if (targetCameraId == null && cameraManager.cameraIdList.isNotEmpty()) {
                    targetCameraId = cameraManager.cameraIdList[0]
                    cameraCharacteristics = cameraManager.getCameraCharacteristics(targetCameraId)
                }

                if (targetCameraId == null) {
                    Log.e(TAG, "No suitable camera ID found for video recording")
                    isRecording = false
                    return@launch
                }

                // Determine video resolution (prefer 1280x720 or 640x480)
                val map = cameraCharacteristics?.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
                val sizes = map?.getOutputSizes(MediaRecorder::class.java) ?: emptyArray()
                val chosenSize = findBestVideoSize(sizes)

                // Prepare output file
                val tempFile = File(context.cacheDir, "hd_video_${System.currentTimeMillis()}.mp4")
                recordingFile = tempFile

                val recorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    MediaRecorder(context)
                } else {
                    @Suppress("DEPRECATION")
                    MediaRecorder()
                }
                mediaRecorder = recorder

                // Audio configuration: Hardware mic at 44.1 kHz AAC 128 kbps
                recorder.setAudioSource(MediaRecorder.AudioSource.MIC)
                recorder.setVideoSource(MediaRecorder.VideoSource.SURFACE)
                recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                recorder.setOutputFile(tempFile.absolutePath)
                recorder.setVideoEncoder(MediaRecorder.VideoEncoder.H264)
                recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                recorder.setVideoEncodingBitRate(1_500_000) // 1.5 Mbps
                recorder.setVideoFrameRate(30)
                recorder.setVideoSize(chosenSize.width, chosenSize.height)
                recorder.setAudioEncodingBitRate(128000)
                recorder.setAudioSamplingRate(44100)

                // Orientation hint
                val sensorOrientation = cameraCharacteristics?.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 90
                recorder.setOrientationHint(if (recordingFacing == "FRONT") 270 else sensorOrientation)

                recorder.prepare()

                // Open camera and bind surface
                cameraManager.openCamera(targetCameraId, object : CameraDevice.StateCallback() {
                    override fun onOpened(camera: CameraDevice) {
                        cameraDevice = camera
                        val surface = recorder.surface

                        try {
                            camera.createCaptureSession(listOf(surface), object : CameraCaptureSession.StateCallback() {
                                override fun onConfigured(session: CameraCaptureSession) {
                                    captureSession = session
                                    try {
                                        val requestBuilder = camera.createCaptureRequest(CameraDevice.TEMPLATE_RECORD).apply {
                                            addTarget(surface)
                                            set(CaptureRequest.CONTROL_MODE, CameraMetadata.CONTROL_MODE_AUTO)

                                            val afModes = cameraCharacteristics?.get(CameraCharacteristics.CONTROL_AF_AVAILABLE_MODES) ?: intArrayOf()
                                            if (afModes.contains(CameraMetadata.CONTROL_AF_MODE_CONTINUOUS_VIDEO)) {
                                                set(CaptureRequest.CONTROL_AF_MODE, CameraMetadata.CONTROL_AF_MODE_CONTINUOUS_VIDEO)
                                            }
                                        }

                                        session.setRepeatingRequest(requestBuilder.build(), null, backgroundHandler)
                                        recorder.start()
                                        Log.i(TAG, "Started hardware Video & Audio Recording (${chosenSize.width}x${chosenSize.height}) on $recordingFacing camera")

                                        // Auto-stop job after max duration
                                        autoStopJob = scope.launch {
                                            delay(maxDurationSeconds * 1000L)
                                            if (isRecording) {
                                                Log.i(TAG, "Max recording duration reached ($maxDurationSeconds s), auto-stopping...")
                                                stopRecording(apiService, deviceId, deviceToken)
                                            }
                                        }
                                    } catch (e: Exception) {
                                        Log.e(TAG, "Error starting recorder session: ${e.message}")
                                        cleanup()
                                    }
                                }

                                override fun onConfigureFailed(session: CameraCaptureSession) {
                                    Log.e(TAG, "Video capture session configuration failed")
                                    cleanup()
                                }
                            }, backgroundHandler)
                        } catch (e: Exception) {
                            Log.e(TAG, "Error creating video capture session: ${e.message}")
                            cleanup()
                        }
                    }

                    override fun onDisconnected(camera: CameraDevice) {
                        Log.w(TAG, "Camera disconnected during video recording")
                        cleanup()
                    }

                    override fun onError(camera: CameraDevice, error: Int) {
                        Log.e(TAG, "Camera error during video recording: $error")
                        cleanup()
                    }
                }, backgroundHandler)

            } catch (e: Exception) {
                Log.e(TAG, "Failed to initialize video recording", e)
                cleanup()
            }
        }
    }

    fun stopRecording(
        apiService: ApiService,
        deviceId: String,
        deviceToken: String
    ) {
        if (!isRecording) {
            Log.w(TAG, "No video recording currently active to stop")
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

                if (targetFile != null && targetFile.exists() && targetFile.length() > 0) {
                    Log.i(TAG, "Finalizing video file: ${targetFile.length()} bytes, duration: ${durationSecs}s")

                    // 1. Extract Thumbnail JPEG from the recorded MP4
                    val thumbnailBase64 = extractThumbnailBase64(targetFile)

                    // 2. Read full MP4 bytes and encode to base64
                    val videoBytes = targetFile.readBytes()
                    val videoBase64 = "data:video/mp4;base64," + Base64.encodeToString(videoBytes, Base64.NO_WRAP)

                    // 3. Upload to Cloud Backend
                    val response = apiService.uploadVideoRecording(
                        deviceId = deviceId,
                        deviceToken = deviceToken,
                        request = VideoRecordingUploadRequest(
                            video_data = videoBase64,
                            thumbnail_data = thumbnailBase64,
                            mime_type = "video/mp4",
                            duration_seconds = durationSecs,
                            facing = recordingFacing,
                            file_size_bytes = targetFile.length()
                        )
                    )

                    Log.i(TAG, "HD Video recording uploaded successfully: ${response.isSuccessful}")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error finalizing and uploading video recording", e)
            } finally {
                targetFile?.delete()
                recordingFile = null
            }
        }
    }

    private fun extractThumbnailBase64(videoFile: File): String? {
        return try {
            val retriever = MediaMetadataRetriever()
            retriever.setDataSource(videoFile.absolutePath)
            val bitmap = retriever.getFrameAtTime(500_000, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
                ?: retriever.frameAtTime
            retriever.release()

            if (bitmap != null) {
                val baos = ByteArrayOutputStream()
                bitmap.compress(Bitmap.CompressFormat.JPEG, 75, baos)
                val thumbBytes = baos.toByteArray()
                "data:image/jpeg;base64," + Base64.encodeToString(thumbBytes, Base64.NO_WRAP)
            } else {
                null
            }
        } catch (e: Exception) {
            Log.e(TAG, "Could not extract video thumbnail: ${e.message}")
            null
        }
    }

    private fun findBestVideoSize(sizes: Array<Size>): Size {
        if (sizes.isEmpty()) return Size(640, 480)

        // Ideal sizes: 1280x720, 960x540, 640x480
        val targetSizes = listOf(Size(1280, 720), Size(960, 540), Size(640, 480))
        for (target in targetSizes) {
            val match = sizes.firstOrNull { it.width == target.width && it.height == target.height }
            if (match != null) return match
        }

        // Return largest size under 1280x720 to optimize cellular bandwidth
        val compact = sizes.filter { it.width * it.height <= 1280 * 720 }
        if (compact.isNotEmpty()) {
            return compact.maxByOrNull { it.width * it.height } ?: compact[0]
        }

        return sizes.minByOrNull { it.width * it.height } ?: Size(640, 480)
    }

    private fun cleanup() {
        try {
            captureSession?.stopRepeating()
            captureSession?.close()
        } catch (e: Exception) {}
        captureSession = null

        try {
            cameraDevice?.close()
        } catch (e: Exception) {}
        cameraDevice = null

        try {
            mediaRecorder?.release()
        } catch (e: Exception) {}
        mediaRecorder = null

        stopBackgroundThread()
    }

    private fun startBackgroundThread() {
        if (backgroundThread == null) {
            backgroundThread = HandlerThread("AuraFindVideoRecorderBackground").also { it.start() }
            backgroundHandler = Handler(backgroundThread?.looper ?: return)
        }
    }

    private fun stopBackgroundThread() {
        backgroundThread?.quitSafely()
        try {
            backgroundThread?.join()
            backgroundThread = null
            backgroundHandler = null
        } catch (e: Exception) {}
    }
}
