package com.findmydevice.security.util

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Handler
import android.os.HandlerThread
import android.util.Base64
import android.util.DisplayMetrics
import android.util.Log
import android.view.WindowManager
import com.findmydevice.security.data.network.ApiService
import com.findmydevice.security.data.network.ScreenFrameRequest
import kotlinx.coroutines.*
import java.io.ByteArrayOutputStream
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.atomic.AtomicBoolean

/**
 * High-Performance Real-Time Screen Mirroring Engine for Parental Control.
 * Captures display frames via Android MediaProjection + VirtualDisplay + ImageReader,
 * compresses frames to optimized low-latency JPEG, and streams to the Parent Web Dashboard.
 */
object ScreenMirrorManager {

    private const val TAG = "ScreenMirrorManager"

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var isMirroring = false
    private var isStreamingActive = false

    private var mediaProjectionManager: MediaProjectionManager? = null
    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null

    private var backgroundThread: HandlerThread? = null
    private var backgroundHandler: Handler? = null

    // Saved MediaProjection grant intent from setup activity
    private var projectionResultCode: Int = 0
    private var projectionResultData: Intent? = null

    private val isUploadingFrame = AtomicBoolean(false)
    private val frameLock = Any()
    private var latestFrameBitmap: Bitmap? = null
    private var targetWidth: Int = 540
    private var targetHeight: Int = 960
    private var screenDensity: Int = DisplayMetrics.DENSITY_HIGH

    fun setMediaProjectionResult(resultCode: Int, data: Intent) {
        projectionResultCode = resultCode
        projectionResultData = data
        Log.i(TAG, "Screen Capture permission cached successfully.")
    }

    fun isProjectionPermissionCached(): Boolean {
        return projectionResultData != null
    }

    fun isMirroringActive(): Boolean = isMirroring

    /**
     * Initializes and starts live screen mirroring stream.
     */
    @SuppressLint("WrongConstant")
    fun startScreenMirror(
        context: Context,
        apiService: ApiService,
        deviceId: String,
        deviceToken: String
    ) {
        if (isMirroring) {
            Log.w(TAG, "Screen mirroring is already active.")
            return
        }

        if (PrivacyManager.isControlsRestricted(context)) {
            Log.w(TAG, "Screen mirror blocked: Device controls paused by user.")
            return
        }

        if (projectionResultData == null) {
            Log.w(TAG, "No MediaProjection token cached. Prompting user permission...")
            val permIntent = Intent(context, com.findmydevice.security.ui.ScreenCapturePermissionActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            }
            context.startActivity(permIntent)
            return
        }

        try {
            startBackgroundThread()

            val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
            val metrics = DisplayMetrics()
            @Suppress("DEPRECATION")
            wm.defaultDisplay.getRealMetrics(metrics)

            screenDensity = metrics.densityDpi
            // Scale down to 540x960 (or aspect proportional) for ultra-low latency & high FPS
            val aspectRatio = metrics.heightPixels.toFloat() / metrics.widthPixels.toFloat()
            targetWidth = 540
            targetHeight = (540 * aspectRatio).toInt()
            if (targetHeight % 2 != 0) targetHeight += 1

            mediaProjectionManager = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            mediaProjection = mediaProjectionManager?.getMediaProjection(projectionResultCode, projectionResultData!!.clone() as Intent)

            if (mediaProjection == null) {
                Log.e(TAG, "Failed to instantiate MediaProjection.")
                return
            }

            imageReader = ImageReader.newInstance(targetWidth, targetHeight, PixelFormat.RGBA_8888, 3)
            imageReader?.setOnImageAvailableListener({ reader ->
                val image = reader.acquireLatestImage() ?: return@setOnImageAvailableListener
                try {
                    val planes = image.planes
                    if (planes.isNotEmpty()) {
                        val buffer = planes[0].buffer
                        val pixelStride = planes[0].pixelStride
                        val rowStride = planes[0].rowStride
                        val rowPadding = rowStride - pixelStride * targetWidth

                        val bitmap = Bitmap.createBitmap(
                            targetWidth + rowPadding / pixelStride,
                            targetHeight,
                            Bitmap.Config.ARGB_8888
                        )
                        bitmap.copyPixelsFromBuffer(buffer)

                        // Crop row padding if necessary
                        val cleanBitmap = if (rowPadding > 0) {
                            Bitmap.createBitmap(bitmap, 0, 0, targetWidth, targetHeight)
                        } else {
                            bitmap
                        }

                        synchronized(frameLock) {
                            latestFrameBitmap = cleanBitmap
                        }

                        triggerScreenFrameUpload(apiService, deviceId, deviceToken)
                    }
                } catch (e: Exception) {
                    // silent frame pacing
                } finally {
                    image.close()
                }
            }, backgroundHandler)

            virtualDisplay = mediaProjection?.createVirtualDisplay(
                "AuraKidsScreenMirror",
                targetWidth,
                targetHeight,
                screenDensity,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                imageReader?.surface,
                null,
                backgroundHandler
            )

            isMirroring = true
            isStreamingActive = true
            Log.i(TAG, "Parental Live Screen Mirroring started (${targetWidth}x${targetHeight} @ 20 FPS).")

        } catch (e: Exception) {
            Log.e(TAG, "Error starting Screen Mirroring: ${e.message}", e)
            stopScreenMirror()
        }
    }

    private fun triggerScreenFrameUpload(apiService: ApiService, deviceId: String, deviceToken: String) {
        if (!isStreamingActive) return
        if (isUploadingFrame.compareAndSet(false, true)) {
            scope.launch(Dispatchers.IO) {
                try {
                    while (isStreamingActive) {
                        val bitmap = synchronized(frameLock) {
                            val b = latestFrameBitmap
                            latestFrameBitmap = null
                            b
                        } ?: break

                        val stream = ByteArrayOutputStream()
                        bitmap.compress(Bitmap.CompressFormat.JPEG, 60, stream)
                        val jpegBytes = stream.toByteArray()
                        val base64 = "data:image/jpeg;base64," + Base64.encodeToString(jpegBytes, Base64.NO_WRAP)
                        val timeIso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).format(Date())

                        try {
                            apiService.pushScreenFrame(
                                deviceId = deviceId,
                                deviceToken = deviceToken,
                                request = ScreenFrameRequest(
                                    image_data = base64,
                                    fps = 20.0f,
                                    timestamp = timeIso,
                                    width = targetWidth,
                                    height = targetHeight
                                )
                            )
                        } catch (e: Exception) {
                            // network transient
                        }

                        delay(45L) // ~20 FPS frame pacing
                    }
                } finally {
                    isUploadingFrame.set(false)
                }
            }
        }
    }

    /**
     * Stops screen mirroring and releases virtual display.
     */
    fun stopScreenMirror() {
        isMirroring = false
        isStreamingActive = false

        try {
            virtualDisplay?.release()
            virtualDisplay = null

            imageReader?.close()
            imageReader = null

            mediaProjection?.stop()
            mediaProjection = null
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping screen mirror: ${e.message}")
        }

        stopBackgroundThread()
        Log.i(TAG, "Screen Mirroring stopped.")
    }

    private fun startBackgroundThread() {
        if (backgroundThread == null) {
            backgroundThread = HandlerThread("AuraKidsScreenMirrorThread").also { it.start() }
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
