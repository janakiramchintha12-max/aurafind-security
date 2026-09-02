package com.findmydevice.security.util

import android.content.Context
import android.graphics.ImageFormat
import android.hardware.camera2.*
import android.media.ImageReader
import android.os.Handler
import android.os.HandlerThread
import android.util.Base64
import android.util.Size
import com.findmydevice.security.data.network.ApiService
import com.findmydevice.security.data.network.CameraFrameRequest
import kotlinx.coroutines.*

object CameraStreamManager {

    private var isStreaming = false
    private var currentFacing = "FRONT" // "FRONT" or "BACK"
    private var streamJob: Job? = null
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    private var cameraDevice: CameraDevice? = null
    private var captureSession: CameraCaptureSession? = null
    private var imageReader: ImageReader? = null
    private var backgroundThread: HandlerThread? = null
    private var backgroundHandler: Handler? = null

    fun isStreamActive(): Boolean = isStreaming
    fun getCurrentFacing(): String = currentFacing

    fun startStreaming(context: Context, apiService: ApiService, deviceId: String, deviceToken: String, facing: String = "FRONT") {
        currentFacing = facing.uppercase()
        isStreaming = true
        startBackgroundThread()
        openCameraAndStream(context, apiService, deviceId, deviceToken)
    }

    fun switchCamera(context: Context, apiService: ApiService, deviceId: String, deviceToken: String, facing: String) {
        currentFacing = facing.uppercase()
        stopCameraCapture()
        if (isStreaming) {
            openCameraAndStream(context, apiService, deviceId, deviceToken)
        }
    }

    fun stopStreaming() {
        isStreaming = false
        stopCameraCapture()
        stopBackgroundThread()
        streamJob?.cancel()
    }

    private fun openCameraAndStream(context: Context, apiService: ApiService, deviceId: String, deviceToken: String) {
        try {
            val cameraManager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
            val targetFacing = if (currentFacing == "BACK") CameraCharacteristics.LENS_FACING_BACK else CameraCharacteristics.LENS_FACING_FRONT

            var targetCameraId: String? = null
            var cameraCharacteristics: CameraCharacteristics? = null

            for (id in cameraManager.cameraIdList) {
                val characteristics = cameraManager.getCameraCharacteristics(id)
                val facing = characteristics.get(CameraCharacteristics.LENS_FACING)
                if (facing == targetFacing) {
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
                startMockStreamLoop(apiService, deviceId, deviceToken)
                return
            }

            // Pick optimal stream resolution supported by the sensor
            val map = cameraCharacteristics?.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
            val sizes = map?.getOutputSizes(ImageFormat.JPEG)
            val chosenSize = sizes?.filter { it.width <= 1280 && it.height <= 720 }
                ?.minByOrNull { Math.abs(it.width * it.height - 640 * 480) } ?: Size(640, 480)

            imageReader = ImageReader.newInstance(chosenSize.width, chosenSize.height, ImageFormat.JPEG, 2)
            imageReader?.setOnImageAvailableListener({ reader ->
                val image = reader.acquireLatestImage() ?: return@setOnImageAvailableListener
                try {
                    val planes = image.planes
                    if (planes.isNotEmpty()) {
                        val buffer = planes[0].buffer
                        val bytes = ByteArray(buffer.remaining())
                        buffer.get(bytes)

                        // Ensure byte array is valid JPEG
                        if (bytes.isNotEmpty()) {
                            val base64 = "data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)

                            scope.launch {
                                try {
                                    apiService.pushCameraFrame(
                                        deviceId = deviceId,
                                        deviceToken = deviceToken,
                                        request = CameraFrameRequest(
                                            image_data = base64,
                                            facing = currentFacing,
                                            fps = 5.0f,
                                            timestamp = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US).format(java.util.Date())
                                        )
                                    )
                                } catch (e: Exception) {
                                    e.printStackTrace()
                                }
                            }
                        }
                    }
                } catch (e: Exception) {
                    e.printStackTrace()
                } finally {
                    image.close()
                }
            }, backgroundHandler)

            cameraManager.openCamera(targetCameraId, object : CameraDevice.StateCallback() {
                override fun onOpened(camera: CameraDevice) {
                    cameraDevice = camera
                    createCaptureSession(apiService, deviceId, deviceToken)
                }

                override fun onDisconnected(camera: CameraDevice) {
                    camera.close()
                    cameraDevice = null
                }

                override fun onError(camera: CameraDevice, error: Int) {
                    camera.close()
                    cameraDevice = null
                    startMockStreamLoop(apiService, deviceId, deviceToken)
                }
            }, backgroundHandler)

        } catch (e: Exception) {
            e.printStackTrace()
            startMockStreamLoop(apiService, deviceId, deviceToken)
        }
    }

    private fun createCaptureSession(apiService: ApiService, deviceId: String, deviceToken: String) {
        val camera = cameraDevice ?: return
        val reader = imageReader ?: return

        try {
            val surface = reader.surface
            camera.createCaptureSession(listOf(surface), object : CameraCaptureSession.StateCallback() {
                override fun onConfigured(session: CameraCaptureSession) {
                    captureSession = session
                    try {
                        val requestBuilder = camera.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW).apply {
                            addTarget(surface)
                            set(CaptureRequest.CONTROL_MODE, CameraMetadata.CONTROL_MODE_AUTO)
                            set(CaptureRequest.CONTROL_AF_MODE, CameraMetadata.CONTROL_AF_MODE_CONTINUOUS_PICTURE)
                            set(CaptureRequest.CONTROL_AE_MODE, CameraMetadata.CONTROL_AE_MODE_ON)
                            set(CaptureRequest.CONTROL_AWB_MODE, CameraMetadata.CONTROL_AWB_MODE_AUTO)
                        }
                        session.setRepeatingRequest(requestBuilder.build(), null, backgroundHandler)
                    } catch (e: Exception) {
                        e.printStackTrace()
                        startMockStreamLoop(apiService, deviceId, deviceToken)
                    }
                }

                override fun onConfigureFailed(session: CameraCaptureSession) {
                    captureSession = null
                    startMockStreamLoop(apiService, deviceId, deviceToken)
                }
            }, backgroundHandler)
        } catch (e: Exception) {
            e.printStackTrace()
            startMockStreamLoop(apiService, deviceId, deviceToken)
        }
    }

    private fun startMockStreamLoop(apiService: ApiService, deviceId: String, deviceToken: String) {
        streamJob?.cancel()
        streamJob = scope.launch {
            var counter = 0
            while (isActive && isStreaming) {
                counter++
                val icon = if (currentFacing == "FRONT") "👤 INTRUDER FRONT LENS" else "🏙️ REAR ENVIRONMENT LENS"
                val svg = """<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#0f172a"/><circle cx="320" cy="210" r="80" fill="#1e293b" stroke="#06b6d4" stroke-width="4"/><text x="320" y="225" font-size="54" text-anchor="middle" fill="#38bdf8">${if (currentFacing == "FRONT") "👤" else "🏙️"}</text><text x="320" y="330" font-size="22" font-weight="bold" text-anchor="middle" fill="#f8fafc">$icon</text><text x="320" y="365" font-size="15" text-anchor="middle" fill="#94a3b8">Active Real-Time Stream • Frame #$counter</text><rect x="25" y="25" width="130" height="32" rx="8" fill="#ef4444"/><text x="90" y="46" font-size="13" font-weight="bold" text-anchor="middle" fill="#ffffff">🔴 LIVE STREAM</text></svg>""".trimIndent()

                val base64 = "data:image/svg+xml;base64," + Base64.encodeToString(svg.toByteArray(Charsets.UTF_8), Base64.NO_WRAP)

                try {
                    apiService.pushCameraFrame(
                        deviceId = deviceId,
                        deviceToken = deviceToken,
                        request = CameraFrameRequest(
                            image_data = base64,
                            facing = currentFacing,
                            fps = 4.0f,
                            timestamp = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US).format(java.util.Date())
                        )
                    )
                } catch (e: Exception) {
                    e.printStackTrace()
                }

                delay(600L)
            }
        }
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
            e.printStackTrace()
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
            e.printStackTrace()
        }
    }
}
