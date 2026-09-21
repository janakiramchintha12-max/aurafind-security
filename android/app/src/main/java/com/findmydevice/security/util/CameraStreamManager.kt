package com.findmydevice.security.util

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.ImageFormat
import android.hardware.camera2.*
import android.media.ImageReader
import android.os.Handler
import android.os.HandlerThread
import android.util.Base64
import android.util.Log
import android.util.Size
import com.findmydevice.security.data.network.ApiService
import com.findmydevice.security.data.network.CameraFrameRequest
import com.findmydevice.security.data.network.SnapshotCreateRequest
import kotlinx.coroutines.*
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Ultra-Reliable High-Performance Camera Stream & Snapshot Engine
 * - Dynamic resolution matching from hardware characteristics
 * - Continuous high-FPS stream for dashboard live monitor
 * - Instant hardware snapshot capture for audit snapshots
 * - Zero-leak buffer recycling
 */
object CameraStreamManager {

    private const val TAG = "CameraStreamManager"

    private var isStreaming = false
    private var currentFacing = "FRONT" // "FRONT" or "BACK"
    private var isTorchOn = false
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private var cameraDevice: CameraDevice? = null
    private var captureSession: CameraCaptureSession? = null
    private var imageReader: ImageReader? = null
    private var backgroundThread: HandlerThread? = null
    private var backgroundHandler: Handler? = null

    private val isUploading = AtomicBoolean(false)
    private val frameLock = Any()
    private var latestPendingFrame: ByteArray? = null
    private var openRetryCount = 0

    fun isStreamActive(): Boolean = isStreaming
    fun getCurrentFacing(): String = currentFacing

    fun findCameraIdForFacing(cameraManager: CameraManager, targetFacing: Int): Pair<String, CameraCharacteristics>? {
        val idList = cameraManager.cameraIdList
        if (idList.isEmpty()) return null

        // Priority 1: Check standard primary IDs ("0" for BACK, "1" for FRONT)
        val preferredId = if (targetFacing == CameraCharacteristics.LENS_FACING_BACK) "0" else "1"
        if (idList.contains(preferredId)) {
            try {
                val chars = cameraManager.getCameraCharacteristics(preferredId)
                if (chars.get(CameraCharacteristics.LENS_FACING) == targetFacing) {
                    return Pair(preferredId, chars)
                }
            } catch (e: Exception) {
                Log.w(TAG, "Error checking preferred camera $preferredId: ${e.message}")
            }
        }

        // Priority 2: Iterate through all available camera IDs to find matching lens facing
        for (id in idList) {
            try {
                val chars = cameraManager.getCameraCharacteristics(id)
                if (chars.get(CameraCharacteristics.LENS_FACING) == targetFacing) {
                    return Pair(id, chars)
                }
            } catch (e: Exception) {
                // Ignore query error on auxiliary sensors
            }
        }

        // Priority 3: Fallback to the first available camera
        try {
            val fallbackId = idList[0]
            val chars = cameraManager.getCameraCharacteristics(fallbackId)
            return Pair(fallbackId, chars)
        } catch (e: Exception) {
            Log.e(TAG, "Failed fallback camera query: ${e.message}")
        }
        return null
    }

    fun startStreaming(context: Context, apiService: ApiService, deviceId: String, deviceToken: String, facing: String = "FRONT") {
        if (PrivacyManager.isCameraPaused(context)) {
            Log.w(TAG, "Camera remote access is paused by device user")
            stopStreaming()
            return
        }
        val requestedFacing = facing.uppercase()
        if (isStreaming && cameraDevice != null && currentFacing == requestedFacing) {
            Log.i(TAG, "Camera stream already active on $requestedFacing; ignoring duplicate start")
            return
        }
        val wasActive = isStreaming || cameraDevice != null
        currentFacing = requestedFacing
        isStreaming = true
        isUploading.set(false)
        openRetryCount = 0
        startBackgroundThread()
        if (wasActive) {
            stopCameraCapture()
            scope.launch {
                delay(350L)
                if (isStreaming) {
                    openCameraAndStream(context, apiService, deviceId, deviceToken)
                }
            }
        } else {
            openCameraAndStream(context, apiService, deviceId, deviceToken)
        }
    }

    fun switchCamera(context: Context, apiService: ApiService, deviceId: String, deviceToken: String, facing: String) {
        if (PrivacyManager.isCameraPaused(context)) {
            stopStreaming()
            return
        }
        val target = facing.uppercase()
        Log.i(TAG, "switchCamera: requested switch from $currentFacing to $target")
        currentFacing = target
        stopCameraCapture()
        openRetryCount = 0
        if (isStreaming) {
            scope.launch {
                // 350ms delay lets Android Camera HAL release sensor
                delay(350L)
                if (isStreaming) {
                    openCameraAndStream(context, apiService, deviceId, deviceToken)
                }
            }
        }
    }

    fun stopStreaming() {
        isStreaming = false
        isUploading.set(false)
        stopCameraCapture()
        stopBackgroundThread()
    }

    @SuppressLint("MissingPermission")
    fun captureSnapshot(
        context: Context,
        apiService: ApiService,
        deviceId: String,
        deviceToken: String,
        facing: String = "FRONT",
        lat: Double? = null,
        lng: Double? = null
    ) {
        if (PrivacyManager.isCameraPaused(context)) {
            Log.w(TAG, "Cannot capture snapshot: camera paused by device user")
            return
        }

        scope.launch {
            try {
                startBackgroundThread()
                val cameraManager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
                val targetFacing = if (facing.uppercase() == "BACK") CameraCharacteristics.LENS_FACING_BACK else CameraCharacteristics.LENS_FACING_FRONT

                val pair = findCameraIdForFacing(cameraManager, targetFacing)
                if (pair == null) {
                    Log.e(TAG, "No camera found for snapshot facing: $facing")
                    return@launch
                }
                val targetCameraId = pair.first
                val cameraCharacteristics = pair.second

                val map = cameraCharacteristics.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
                val sizes = map?.getOutputSizes(ImageFormat.JPEG) ?: emptyArray()
                val chosenSize = findBestMatchingSize(sizes, 640, 480)

                val snapReader = ImageReader.newInstance(chosenSize.width, chosenSize.height, ImageFormat.JPEG, 2)

                var snapCamera: CameraDevice? = null
                var snapSession: CameraCaptureSession? = null

                snapReader.setOnImageAvailableListener({ reader ->
                    val image = reader.acquireLatestImage() ?: return@setOnImageAvailableListener
                    try {
                        val planes = image.planes
                        if (planes.isNotEmpty()) {
                            val buffer = planes[0].buffer
                            val bytes = ByteArray(buffer.remaining())
                            buffer.get(bytes)

                            if (bytes.isNotEmpty()) {
                                val base64 = "data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
                                val timeIso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).format(Date())

                                scope.launch {
                                    try {
                                        // Save as permanent snapshot record
                                        apiService.createSnapshot(
                                            deviceId = deviceId,
                                            deviceToken = deviceToken,
                                            request = SnapshotCreateRequest(
                                                image_data = base64,
                                                latitude = lat,
                                                longitude = lng,
                                                is_intruder_alert = false
                                            )
                                        )
                                        // Also push as live frame for instant display
                                        apiService.pushCameraFrame(
                                            deviceId = deviceId,
                                            deviceToken = deviceToken,
                                            request = CameraFrameRequest(
                                                image_data = base64,
                                                facing = facing.uppercase(),
                                                fps = 1.0f,
                                                timestamp = timeIso
                                            )
                                        )
                                    } catch (e: Exception) {
                                        Log.e(TAG, "Failed uploading snapshot: ${e.message}")
                                    }
                                }
                            }
                        }
                    } catch (e: Exception) {
                        Log.e(TAG, "Error processing snapshot image: ${e.message}")
                    } finally {
                        image.close()
                        if (!isStreaming) {
                            try {
                                snapSession?.close()
                                snapCamera?.close()
                                snapReader.close()
                            } catch (e: Exception) {
                                // ignore
                            }
                        }
                    }
                }, backgroundHandler)

                cameraManager.openCamera(targetCameraId, object : CameraDevice.StateCallback() {
                    override fun onOpened(camera: CameraDevice) {
                        snapCamera = camera
                        try {
                            camera.createCaptureSession(listOf(snapReader.surface), object : CameraCaptureSession.StateCallback() {
                                override fun onConfigured(session: CameraCaptureSession) {
                                    snapSession = session
                                    try {
                                        val req = try {
                                            camera.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE)
                                        } catch (e: Exception) {
                                            try {
                                                camera.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW)
                                            } catch (e2: Exception) {
                                                camera.createCaptureRequest(CameraDevice.TEMPLATE_RECORD)
                                            }
                                        }
                                        req.apply {
                                            addTarget(snapReader.surface)
                                            set(CaptureRequest.CONTROL_MODE, CameraMetadata.CONTROL_MODE_AUTO)
                                            set(CaptureRequest.JPEG_QUALITY, 80.toByte())
                                        }
                                        session.capture(req.build(), null, backgroundHandler)
                                    } catch (e: Exception) {
                                        Log.e(TAG, "Error triggering single capture: ${e.message}")
                                    }
                                }

                                override fun onConfigureFailed(session: CameraCaptureSession) {
                                    Log.e(TAG, "Snapshot capture session config failed")
                                    snapCamera?.close()
                                }
                            }, backgroundHandler)
                        } catch (e: Exception) {
                            Log.e(TAG, "Error creating snapshot capture session: ${e.message}")
                            snapCamera?.close()
                        }
                    }

                    override fun onDisconnected(camera: CameraDevice) {
                        camera.close()
                    }

                    override fun onError(camera: CameraDevice, error: Int) {
                        Log.e(TAG, "Snapshot camera open error: $error")
                        camera.close()
                    }
                }, backgroundHandler)

            } catch (e: Exception) {
                Log.e(TAG, "Failed to capture hardware snapshot: ${e.message}")
            }
        }
    }

    @SuppressLint("MissingPermission")
    private fun openCameraAndStream(context: Context, apiService: ApiService, deviceId: String, deviceToken: String) {
        if (PrivacyManager.isCameraPaused(context)) {
            stopStreaming()
            return
        }
        try {
            val cameraManager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
            val targetFacing = if (currentFacing == "BACK") CameraCharacteristics.LENS_FACING_BACK else CameraCharacteristics.LENS_FACING_FRONT

            val pair = findCameraIdForFacing(cameraManager, targetFacing)
            if (pair == null) {
                Log.e(TAG, "No suitable camera ID found for facing: $currentFacing")
                return
            }
            val targetCameraId = pair.first
            val cameraCharacteristics = pair.second

            val map = cameraCharacteristics.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
            val sizes = map?.getOutputSizes(ImageFormat.JPEG) ?: emptyArray()
            val chosenSize = findBestMatchingSize(sizes, 640, 480)

            Log.i(TAG, "Opening stream camera $targetCameraId ($currentFacing) at ${chosenSize.width}x${chosenSize.height}")

            imageReader?.close()
            imageReader = ImageReader.newInstance(chosenSize.width, chosenSize.height, ImageFormat.JPEG, 4)
            imageReader?.setOnImageAvailableListener({ reader ->
                val image = reader.acquireLatestImage() ?: return@setOnImageAvailableListener
                try {
                    val planes = image.planes
                    if (planes.isNotEmpty()) {
                        val buffer = planes[0].buffer
                        val bytes = ByteArray(buffer.remaining())
                        buffer.get(bytes)

                        if (bytes.isNotEmpty()) {
                            synchronized(frameLock) {
                                latestPendingFrame = bytes
                            }
                            triggerFrameUpload(apiService, deviceId, deviceToken)
                        }
                    }
                } catch (e: Exception) {
                    // quiet
                } finally {
                    image.close()
                }
            }, backgroundHandler)

            cameraManager.openCamera(targetCameraId, object : CameraDevice.StateCallback() {
                override fun onOpened(camera: CameraDevice) {
                    Log.i(TAG, "Camera opened successfully: ${camera.id} ($currentFacing)")
                    cameraDevice = camera
                    openRetryCount = 0
                    createCaptureSession(apiService, deviceId, deviceToken, cameraCharacteristics)
                }

                override fun onDisconnected(camera: CameraDevice) {
                    Log.w(TAG, "Camera disconnected: ${camera.id}")
                    camera.close()
                    cameraDevice = null
                }

                override fun onError(camera: CameraDevice, error: Int) {
                    Log.e(TAG, "Camera open error code: $error on camera ${camera.id} ($currentFacing)")
                    camera.close()
                    cameraDevice = null

                    if (isStreaming && (error == CameraDevice.StateCallback.ERROR_CAMERA_IN_USE || error == CameraDevice.StateCallback.ERROR_MAX_CAMERAS_IN_USE) && openRetryCount < 3) {
                        openRetryCount++
                        Log.w(TAG, "Retrying camera open in 400ms (attempt $openRetryCount/3)...")
                        scope.launch {
                            delay(400L)
                            if (isStreaming) {
                                openCameraAndStream(context, apiService, deviceId, deviceToken)
                            }
                        }
                    }
                }
            }, backgroundHandler)

        } catch (e: Exception) {
            Log.e(TAG, "Exception opening camera: ${e.message}")
        }
    }

    private fun triggerFrameUpload(apiService: ApiService, deviceId: String, deviceToken: String) {
        if (!isStreaming) return
        if (isUploading.compareAndSet(false, true)) {
            scope.launch(Dispatchers.IO) {
                try {
                    while (isStreaming) {
                        val frameBytes = synchronized(frameLock) {
                            val b = latestPendingFrame
                            latestPendingFrame = null
                            b
                        } ?: break

                        val base64 = "data:image/jpeg;base64," + Base64.encodeToString(frameBytes, Base64.NO_WRAP)
                        val timeIso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).format(Date())

                        try {
                            apiService.pushCameraFrame(
                                deviceId = deviceId,
                                deviceToken = deviceToken,
                                request = CameraFrameRequest(
                                    image_data = base64,
                                    facing = currentFacing,
                                    fps = 20.0f,
                                    timestamp = timeIso
                                )
                            )
                        } catch (e: Exception) {
                            // quiet network drops
                        }

                        // Minimal breathing space to ensure packet pacing
                        delay(25L)
                    }
                } finally {
                    isUploading.set(false)
                }
            }
        }
    }

    private fun createCaptureSession(apiService: ApiService, deviceId: String, deviceToken: String, characteristics: CameraCharacteristics?) {
        val camera = cameraDevice ?: return
        val reader = imageReader ?: return

        try {
            val surface = reader.surface
            camera.createCaptureSession(listOf(surface), object : CameraCaptureSession.StateCallback() {
                override fun onConfigured(session: CameraCaptureSession) {
                    captureSession = session
                    try {
                        val requestBuilder = try {
                            camera.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW)
                        } catch (e: Exception) {
                            try {
                                camera.createCaptureRequest(CameraDevice.TEMPLATE_RECORD)
                            } catch (e2: Exception) {
                                camera.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE)
                            }
                        }
                        requestBuilder.apply {
                            addTarget(surface)
                            set(CaptureRequest.CONTROL_MODE, CameraMetadata.CONTROL_MODE_AUTO)

                            val afModes = characteristics?.get(CameraCharacteristics.CONTROL_AF_AVAILABLE_MODES) ?: intArrayOf()
                            if (afModes.contains(CameraMetadata.CONTROL_AF_MODE_CONTINUOUS_PICTURE)) {
                                set(CaptureRequest.CONTROL_AF_MODE, CameraMetadata.CONTROL_AF_MODE_CONTINUOUS_PICTURE)
                            } else if (afModes.contains(CameraMetadata.CONTROL_AF_MODE_AUTO)) {
                                set(CaptureRequest.CONTROL_AF_MODE, CameraMetadata.CONTROL_AF_MODE_AUTO)
                            }

                            val aeModes = characteristics?.get(CameraCharacteristics.CONTROL_AE_AVAILABLE_MODES) ?: intArrayOf()
                            if (aeModes.contains(CameraMetadata.CONTROL_AE_MODE_ON)) {
                                set(CaptureRequest.CONTROL_AE_MODE, CameraMetadata.CONTROL_AE_MODE_ON)
                            }

                            set(CaptureRequest.JPEG_QUALITY, 55.toByte())

                            if (isTorchOn && currentFacing == "BACK") {
                                set(CaptureRequest.FLASH_MODE, CameraMetadata.FLASH_MODE_TORCH)
                            }
                        }

                        val req = requestBuilder.build()
                        session.setRepeatingRequest(req, object : CameraCaptureSession.CaptureCallback() {
                            override fun onCaptureCompleted(session: CameraCaptureSession, request: CaptureRequest, result: TotalCaptureResult) {
                                super.onCaptureCompleted(session, request, result)
                            }
                        }, backgroundHandler)

                        Log.i(TAG, "Capture session configured and repeating request active")
                    } catch (e: Exception) {
                        Log.e(TAG, "Error configuring repeating request: ${e.message}")
                    }
                }

                override fun onConfigureFailed(session: CameraCaptureSession) {
                    Log.e(TAG, "Capture session onConfigureFailed")
                    captureSession = null
                }
            }, backgroundHandler)
        } catch (e: Exception) {
            Log.e(TAG, "Error creating capture session: ${e.message}")
        }
    }

    private fun findBestMatchingSize(sizes: Array<Size>, targetWidth: Int, targetHeight: Int): Size {
        if (sizes.isEmpty()) return Size(640, 480)

        // Find exact match if exists
        val exact = sizes.firstOrNull { (it.width == targetWidth && it.height == targetHeight) || (it.width == targetHeight && it.height == targetWidth) }
        if (exact != null) return exact

        // Find sizes with resolution <= 1280x720, pick closest to 640x480
        val compactSizes = sizes.filter { it.width * it.height <= 1280 * 720 }
        if (compactSizes.isNotEmpty()) {
            return compactSizes.minByOrNull { Math.abs((it.width * it.height) - (targetWidth * targetHeight)) } ?: compactSizes[0]
        }

        // Default to smallest supported size to minimize network overhead
        return sizes.minByOrNull { it.width * it.height } ?: Size(640, 480)
    }

    private fun stopCameraCapture() {
        try {
            captureSession?.stopRepeating()
            captureSession?.close()
            captureSession = null

            cameraDevice?.close()
            cameraDevice = null

            imageReader?.close()
            imageReader = null
        } catch (e: Exception) {
            Log.e(TAG, "Error closing camera capture: ${e.message}")
        }
    }

    private fun startBackgroundThread() {
        if (backgroundThread == null) {
            backgroundThread = HandlerThread("AuraFindCameraBackground").also { it.start() }
            backgroundHandler = Handler(backgroundThread?.looper ?: return)
        }
    }

    private fun stopBackgroundThread() {
        backgroundThread?.quitSafely()
        try {
            backgroundThread?.join()
            backgroundThread = null
            backgroundHandler = null
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping background thread: ${e.message}")
        }
    }
}
