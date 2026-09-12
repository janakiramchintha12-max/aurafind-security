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
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.util.DisplayMetrics
import android.util.Log
import android.view.Surface
import android.view.WindowManager
import com.findmydevice.security.data.network.ApiService
import kotlinx.coroutines.*
import okhttp3.*
import okio.ByteString
import okio.ByteString.Companion.toByteString
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Enterprise-Grade Real-Time Media Streaming Engine.
 * Manages low-latency binary WebSocket communication with Cloud Backend.
 * Streams Hardware H.264 Video (Screen Mirror & Camera) + 16kHz PCM Ambient Audio with sub-100ms latency.
 */
object RealtimeMediaStreamer {

    private const val TAG = "RealtimeStreamer"

    // Binary Packet Types
    private const val PKT_VIDEO: Byte = 0x01
    private const val PKT_AUDIO: Byte = 0x02
    private const val PKT_CONTROL: Byte = 0x03
    private const val PKT_DASHBOARD_AUDIO: Byte = 0x04

    // Stream Source IDs
    private const val SRC_SCREEN: Byte = 0x01
    private const val SRC_CAM_FRONT: Byte = 0x02
    private const val SRC_CAM_BACK: Byte = 0x03
    private const val SRC_MIC: Byte = 0x04

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val isWsConnected = AtomicBoolean(false)
    private var webSocket: WebSocket? = null
    private var okHttpClient: OkHttpClient? = null

    // Screen Mirror Hardware Pipeline
    private var screenEncoder: HardwareH264Encoder? = null
    private var screenVirtualDisplay: VirtualDisplay? = null
    private var screenMediaProjection: MediaProjection? = null
    private val isScreenMirroring = AtomicBoolean(false)

    // Camera Hardware Pipeline
    private var cameraEncoder: HardwareH264Encoder? = null
    private var cameraDevice: CameraDevice? = null
    private var cameraCaptureSession: CameraCaptureSession? = null
    private var currentCameraFacing: String = "FRONT"
    private val isCameraStreaming = AtomicBoolean(false)
    private var cameraBgThread: HandlerThread? = null
    private var cameraBgHandler: Handler? = null

    // Ambient Audio Hardware Pipeline
    private var audioRecord: AudioRecord? = null
    private var audioTrack: AudioTrack? = null
    private val isAudioStreaming = AtomicBoolean(false)
    private var audioJob: Job? = null

    // Screen projection tokens cached
    private var cachedProjectionResultCode: Int = 0
    private var cachedProjectionResultData: Intent? = null

    fun setProjectionIntent(resultCode: Int, data: Intent) {
        cachedProjectionResultCode = resultCode
        cachedProjectionResultData = data
        Log.i(TAG, "Screen Capture grant token cached.")
    }

    fun isProjectionPermissionCached(): Boolean {
        return cachedProjectionResultData != null || screenMediaProjection != null
    }

    fun isScreenMirrorActive(): Boolean = isScreenMirroring.get()
    fun isCameraStreamActive(): Boolean = isCameraStreaming.get()
    fun isAudioStreamActive(): Boolean = isAudioStreaming.get()

    /**
     * Initializes or connects the binary WebSocket connection to the backend.
     */
    private fun ensureWebSocketConnected(deviceId: String, deviceToken: String) {
        if (isWsConnected.get() && webSocket != null) return

        val wsUrl = "${NetworkUtils.BASE_URL.replace("http://", "ws://").replace("https://", "wss://")}api/v1/stream/ws?device_id=$deviceId&device_token=$deviceToken"

        if (okHttpClient == null) {
            okHttpClient = OkHttpClient.Builder()
                .readTimeout(0, TimeUnit.MILLISECONDS)
                .writeTimeout(5000, TimeUnit.MILLISECONDS)
                .pingInterval(15, TimeUnit.SECONDS)
                .retryOnConnectionFailure(true)
                .build()
        }

        val request = Request.Builder().url(wsUrl).build()
        webSocket = okHttpClient?.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                isWsConnected.set(true)
                Log.i(TAG, "Binary Media Stream WebSocket connected to Cloud Hub.")
            }

            override fun onMessage(ws: WebSocket, bytes: ByteString) {
                handleIncomingBinaryPacket(bytes.toByteArray())
            }

            override fun onClosing(ws: WebSocket, code: Int, reason: String) {
                isWsConnected.set(false)
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                isWsConnected.set(false)
                webSocket = null
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                isWsConnected.set(false)
                webSocket = null
                Log.w(TAG, "WebSocket stream disconnect: ${t.message}")
            }
        })
    }

    /**
     * Builds a 10-byte binary packet header + payload and transmits over WebSocket.
     */
    private fun sendBinaryPacket(packetType: Byte, sourceId: Byte, timestampUs: Long, payload: ByteArray) {
        val ws = webSocket
        if (ws == null || !isWsConnected.get() || payload.isEmpty()) return

        val header = ByteBuffer.allocate(10).order(ByteOrder.BIG_ENDIAN).apply {
            put(packetType)
            put(sourceId)
            putLong(timestampUs)
        }.array()

        val fullPacket = ByteArray(10 + payload.size)
        System.arraycopy(header, 0, fullPacket, 0, 10)
        System.arraycopy(payload, 0, fullPacket, 10, payload.size)

        ws.send(fullPacket.toByteString())
    }

    /**
     * Handles incoming binary packet from Parent Dashboard (e.g. Duplex Voice back to Child Phone).
     */
    private fun handleIncomingBinaryPacket(data: ByteArray) {
        if (data.size < 10) return
        val pktType = data[0]
        if (pktType == PKT_DASHBOARD_AUDIO) {
            val audioPayload = ByteArray(data.size - 10)
            System.arraycopy(data, 10, audioPayload, 0, audioPayload.size)
            playDuplexAudio(audioPayload)
        }
    }

    // ==========================================
    // 1. LIVE SCREEN MIRRORING (HARDWARE H.264)
    // ==========================================

    @SuppressLint("WrongConstant")
    fun startScreenMirrorStream(
        context: Context,
        deviceId: String,
        deviceToken: String,
        targetWidth: Int = 720,
        targetHeight: Int = 1280
    ) {
        if (isScreenMirroring.get()) {
            Log.w(TAG, "Screen mirror is already running.")
            return
        }

        if (PrivacyManager.isControlsRestricted(context)) {
            Log.w(TAG, "Screen mirror blocked by privacy settings.")
            return
        }

        if (screenMediaProjection == null && cachedProjectionResultData == null) {
            Log.w(TAG, "MediaProjection token missing. Prompting user...")
            val permIntent = Intent(context, com.findmydevice.security.ui.ScreenCapturePermissionActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            }
            context.startActivity(permIntent)
            return
        }

        ensureWebSocketConnected(deviceId, deviceToken)

        try {
            val wm = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager
            val metrics = DisplayMetrics()
            @Suppress("DEPRECATION")
            wm.defaultDisplay.getRealMetrics(metrics)
            val densityDpi = metrics.densityDpi

            // Responsive dimensions (ensure even numbers for H.264 encoder)
            val aspect = metrics.heightPixels.toFloat() / metrics.widthPixels.toFloat()
            val encWidth = 540
            var encHeight = (540 * aspect).toInt()
            if (encHeight % 2 != 0) encHeight += 1

            screenEncoder = HardwareH264Encoder(
                width = encWidth,
                height = encHeight,
                frameRate = 30,
                bitRate = 1_200_000,
                iFrameIntervalSeconds = 1
            ) { nalBytes, isKeyFrame, timestampUs ->
                sendBinaryPacket(PKT_VIDEO, SRC_SCREEN, timestampUs, nalBytes)
            }

            val encoderSurface = screenEncoder?.start()
            if (encoderSurface == null) {
                Log.e(TAG, "Failed to start screen hardware encoder surface.")
                stopScreenMirrorStream()
                return
            }

            if (screenMediaProjection == null && cachedProjectionResultData != null) {
                val projectionManager = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
                screenMediaProjection = projectionManager.getMediaProjection(
                    cachedProjectionResultCode,
                    cachedProjectionResultData!!.clone() as Intent
                )

                // Mandatory Android 14 MediaProjection callback registration
                screenMediaProjection?.registerCallback(object : MediaProjection.Callback() {
                    override fun onStop() {
                        Log.i(TAG, "Screen MediaProjection stopped by system")
                        screenMediaProjection = null
                        cachedProjectionResultData = null
                        stopScreenMirrorStream()
                    }
                }, null)
            }

            screenVirtualDisplay = screenMediaProjection?.createVirtualDisplay(
                "AuraFindScreenMirrorHW",
                encWidth,
                encHeight,
                densityDpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                encoderSurface,
                object : VirtualDisplay.Callback() {
                    override fun onPaused() {
                        Log.d(TAG, "Screen VirtualDisplay paused")
                    }
                    override fun onResumed() {
                        Log.d(TAG, "Screen VirtualDisplay resumed")
                    }
                    override fun onStopped() {
                        Log.d(TAG, "Screen VirtualDisplay stopped")
                    }
                },
                null
            )

            isScreenMirroring.set(true)
            Log.i(TAG, "Hardware H.264 Screen Mirroring Stream active (${encWidth}x${encHeight} @ 30 FPS).")

        } catch (e: Exception) {
            Log.e(TAG, "Error starting Screen Mirror stream: ${e.message}", e)
            stopScreenMirrorStream()
        }
    }

    fun stopScreenMirrorStream() {
        isScreenMirroring.set(false)
        try {
            screenVirtualDisplay?.release()
        } catch (e: Exception) {}
        screenVirtualDisplay = null

        screenEncoder?.stop()
        screenEncoder = null

        Log.i(TAG, "Hardware Screen Mirror stream stopped.")
    }

    // ==========================================
    // 2. LIVE CAMERA SURVEILLANCE (HARDWARE H.264)
    // ==========================================

    @SuppressLint("MissingPermission")
    fun startCameraStream(
        context: Context,
        deviceId: String,
        deviceToken: String,
        facing: String = "FRONT",
        width: Int = 640,
        height: Int = 480
    ) {
        if (PrivacyManager.isCameraPaused(context)) {
            Log.w(TAG, "Camera stream paused by device user.")
            return
        }

        currentCameraFacing = facing.uppercase()
        ensureWebSocketConnected(deviceId, deviceToken)
        startCameraBgThread()

        try {
            val cameraManager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager
            val targetFacing = if (currentCameraFacing == "BACK") CameraCharacteristics.LENS_FACING_BACK else CameraCharacteristics.LENS_FACING_FRONT

            var targetCameraId: String? = null
            for (id in cameraManager.cameraIdList) {
                val characteristics = cameraManager.getCameraCharacteristics(id)
                if (characteristics.get(CameraCharacteristics.LENS_FACING) == targetFacing) {
                    targetCameraId = id
                    break
                }
            }
            if (targetCameraId == null && cameraManager.cameraIdList.isNotEmpty()) {
                targetCameraId = cameraManager.cameraIdList[0]
            }
            if (targetCameraId == null) return

            val sourceId = if (currentCameraFacing == "BACK") SRC_CAM_BACK else SRC_CAM_FRONT

            cameraEncoder = HardwareH264Encoder(
                width = width,
                height = height,
                frameRate = 30,
                bitRate = 800_000,
                iFrameIntervalSeconds = 1
            ) { nalBytes, isKeyFrame, timestampUs ->
                sendBinaryPacket(PKT_VIDEO, sourceId, timestampUs, nalBytes)
            }

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
                                    }
                                    session.setRepeatingRequest(req.build(), null, cameraBgHandler)
                                    isCameraStreaming.set(true)
                                    Log.i(TAG, "Hardware H.264 Camera Stream active ($currentCameraFacing camera @ 30 FPS).")
                                } catch (e: Exception) {
                                    Log.e(TAG, "Error setting camera repeating request: ${e.message}")
                                }
                            }

                            override fun onConfigureFailed(session: CameraCaptureSession) {
                                stopCameraStream()
                            }
                        }, cameraBgHandler)
                    } catch (e: Exception) {
                        Log.e(TAG, "Error creating camera capture session: ${e.message}")
                    }
                }

                override fun onDisconnected(camera: CameraDevice) {
                    camera.close()
                    cameraDevice = null
                }

                override fun onError(camera: CameraDevice, error: Int) {
                    camera.close()
                    cameraDevice = null
                }
            }, cameraBgHandler)

        } catch (e: Exception) {
            Log.e(TAG, "Error opening camera hardware: ${e.message}", e)
            stopCameraStream()
        }
    }

    fun stopCameraStream() {
        isCameraStreaming.set(false)
        try {
            cameraCaptureSession?.stopRepeating()
            cameraCaptureSession?.close()
        } catch (e: Exception) {}
        cameraCaptureSession = null

        try {
            cameraDevice?.close()
        } catch (e: Exception) {}
        cameraDevice = null

        cameraEncoder?.stop()
        cameraEncoder = null

        stopCameraBgThread()
        Log.i(TAG, "Hardware Camera Stream stopped.")
    }

    private fun startCameraBgThread() {
        if (cameraBgThread == null) {
            cameraBgThread = HandlerThread("AuraFindCamHWThread").also { it.start() }
            cameraBgHandler = Handler(cameraBgThread!!.looper)
        }
    }

    private fun stopCameraBgThread() {
        cameraBgThread?.quitSafely()
        try {
            cameraBgThread?.join()
        } catch (e: Exception) {}
        cameraBgThread = null
        cameraBgHandler = null
    }

    // ==========================================
    // 3. LIVE AMBIENT AUDIO & DUPLEX INTERCOM
    // ==========================================

    @SuppressLint("MissingPermission")
    fun startAudioStream(context: Context, deviceId: String, deviceToken: String) {
        if (isAudioStreaming.get()) return
        if (PrivacyManager.isMicPaused(context)) return

        ensureWebSocketConnected(deviceId, deviceToken)

        val sampleRate = 16000
        val channelConfig = AudioFormat.CHANNEL_IN_MONO
        val audioFormat = AudioFormat.ENCODING_PCM_16BIT
        val minBufferSize = AudioRecord.getMinBufferSize(sampleRate, channelConfig, audioFormat)
        val bufferSize = Math.max(minBufferSize, 1280)

        try {
            audioRecord = AudioRecord(
                MediaRecorder.AudioSource.MIC,
                sampleRate,
                channelConfig,
                audioFormat,
                bufferSize
            )

            if (audioRecord?.state != AudioRecord.STATE_INITIALIZED) {
                return
            }

            audioRecord?.startRecording()
            isAudioStreaming.set(true)

            audioJob = scope.launch(Dispatchers.IO) {
                val pcmBuffer = ByteArray(640) // 20ms chunk @ 16kHz 16-bit Mono (320 samples = 640 bytes)
                while (isActive && isAudioStreaming.get()) {
                    val read = audioRecord?.read(pcmBuffer, 0, pcmBuffer.size) ?: 0
                    if (read > 0) {
                        val timestampUs = System.currentTimeMillis() * 1000L
                        sendBinaryPacket(PKT_AUDIO, SRC_MIC, timestampUs, pcmBuffer.copyOf(read))
                    }
                    delay(18L) // 20ms frame pacing
                }
            }
            Log.i(TAG, "Real-time PCM Audio Stream active (16kHz Studio Mic).")

        } catch (e: Exception) {
            Log.e(TAG, "Error starting live audio stream: ${e.message}", e)
            stopAudioStream()
        }
    }

    fun stopAudioStream() {
        isAudioStreaming.set(false)
        audioJob?.cancel()
        audioJob = null

        try {
            audioRecord?.stop()
            audioRecord?.release()
        } catch (e: Exception) {}
        audioRecord = null

        Log.i(TAG, "Live Audio Stream stopped.")
    }

    private fun playDuplexAudio(pcmBytes: ByteArray) {
        if (audioTrack == null) {
            val sampleRate = 16000
            val minBuf = AudioTrack.getMinBufferSize(sampleRate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
            audioTrack = AudioTrack(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
                AudioFormat.Builder()
                    .setSampleRate(sampleRate)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .build(),
                Math.max(minBuf, 2048),
                AudioTrack.MODE_STREAM,
                AudioManager.AUDIO_SESSION_ID_GENERATE
            ).apply { play() }
        }
        try {
            audioTrack?.write(pcmBytes, 0, pcmBytes.size)
        } catch (e: Exception) {}
    }

    fun stopAllStreams() {
        stopScreenMirrorStream()
        stopCameraStream()
        stopAudioStream()
        try {
            audioTrack?.stop()
            audioTrack?.release()
        } catch (e: Exception) {}
        audioTrack = null
    }
}
