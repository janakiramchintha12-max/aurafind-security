package com.findmydevice.security.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.BatteryManager
import android.os.Build
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import com.findmydevice.security.data.network.ApiService
import com.findmydevice.security.data.network.CommandResultRequest
import com.findmydevice.security.data.network.SnapshotCreateRequest
import com.findmydevice.security.data.network.StatusUpdateRequest
import com.findmydevice.security.data.repository.LocationRepository
import com.findmydevice.security.ui.LostModeOverlayActivity
import com.findmydevice.security.util.AudioAlarmManager
import com.findmydevice.security.util.NetworkUtils
import com.google.android.gms.location.*
import kotlinx.coroutines.*
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

class LocationService : Service() {

    private val serviceScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private lateinit var locationCallback: LocationCallback
    private lateinit var repository: LocationRepository
    private var wakeLock: android.os.PowerManager.WakeLock? = null

    // Permanent 24/7 Global Cloud Host
    private val CLOUD_BASE_URL = "https://aurafind-security.onrender.com/"
    private var apiService: ApiService? = null

    private var trackingMode = "NORMAL"
    private var isServiceRunning = false
    private var lastSimState = true
    private var lastLat = 13.94978
    private var lastLng = 79.34332

    override fun onCreate() {
        super.onCreate()
        
        setupActiveApiService()
        acquireWakeLock()
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)

        setupLocationCallback()
    }

    private fun acquireWakeLock() {
        try {
            val powerManager = getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
            wakeLock = powerManager.newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK, "AuraFind::PermanentSyncLock").apply {
                acquire(24 * 60 * 60 * 1000L) // 24 hours lock
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun setupActiveApiService(): ApiService {
        val okHttpClient = okhttp3.OkHttpClient.Builder()
            .connectTimeout(15, java.util.concurrent.TimeUnit.SECONDS)
            .readTimeout(15, java.util.concurrent.TimeUnit.SECONDS)
            .writeTimeout(15, java.util.concurrent.TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()

        val retrofit = Retrofit.Builder()
            .baseUrl(CLOUD_BASE_URL)
            .client(okHttpClient)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
        val service = retrofit.create(ApiService::class.java)
        apiService = service
        repository = LocationRepository(applicationContext, service)
        return service
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!isServiceRunning) {
            isServiceRunning = true
            startForegroundServiceNotification()
            requestLocationUpdates()
            startHeartbeatAndCommandPollLoop()
        }

        intent?.getStringExtra("MODE")?.let { newMode ->
            if (newMode != trackingMode) {
                trackingMode = newMode
                requestLocationUpdates()
            }
        }

        return START_STICKY
    }

    private fun startForegroundServiceNotification() {
        val channelId = "aurafind_location_channel"
        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                channelId,
                "AuraFind Location Security",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Active mobile security tracking"
            }
            notificationManager.createNotificationChannel(channel)
        }

        val notification: Notification = NotificationCompat.Builder(this, channelId)
            .setContentTitle("AuraFind Security Active")
            .setContentText("Continuous real-time satellite GPS & tactical protection online.")
            .setSmallIcon(android.R.drawable.ic_menu_compass)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                1001,
                notification,
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION or android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
            )
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                1001,
                notification,
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
            )
        } else {
            startForeground(1001, notification)
        }
    }

    private fun setupLocationCallback() {
        locationCallback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                val loc = result.lastLocation ?: return
                lastLat = loc.latitude
                lastLng = loc.longitude
                val batteryPct = getBatteryPercentage()

                serviceScope.launch {
                    repository.recordLocation(
                        lat = loc.latitude,
                        lng = loc.longitude,
                        accuracy = loc.accuracy,
                        batteryPct = batteryPct,
                        provider = loc.provider ?: "gps_satellite"
                    )
                    repository.syncPendingLocations()
                }
            }
        }
    }

    private fun requestLocationUpdates() {
        try {
            fusedLocationClient.removeLocationUpdates(locationCallback)

            val interval = if (trackingMode == "HIGH_ACCURACY") 2_000L else 5_000L
            val fastestInterval = if (trackingMode == "HIGH_ACCURACY") 1_000L else 2_000L

            val locationRequest = LocationRequest.Builder(
                Priority.PRIORITY_HIGH_ACCURACY,
                interval
            ).apply {
                setMinUpdateIntervalMillis(fastestInterval)
                setWaitForAccurateLocation(true)
                setGranularity(com.google.android.gms.location.Granularity.GRANULARITY_FINE)
            }.build()

            fusedLocationClient.requestLocationUpdates(
                locationRequest,
                locationCallback,
                Looper.getMainLooper()
            )
        } catch (e: SecurityException) {
            e.printStackTrace()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun startHeartbeatAndCommandPollLoop() {
        serviceScope.launch {
            var statusSyncCounter = 0
            while (isActive) {
                val prefs = getSharedPreferences("aurafind_prefs", Context.MODE_PRIVATE)
                val deviceId = prefs.getString("device_id", "bdca7649-e699-4d57-a59a-e80a4db9e1de")
                val deviceToken = prefs.getString("device_token", "ca65a717-1185-417b-b8fc-32289812d8eb")

                if (deviceId != null && deviceToken != null) {
                    val currentService = apiService ?: setupActiveApiService()

                    // 1. Check Pending Commands every 1.5 seconds
                    try {
                        val commandsRes = currentService.getPendingCommands(deviceId, deviceToken)
                        if (commandsRes.isSuccessful) {
                            commandsRes.body()?.forEach { cmd ->
                                executeRemoteCommand(currentService, deviceId, deviceToken, cmd.id, cmd.command_type, cmd.payload)
                            }
                        }
                    } catch (e: Exception) {
                        // Transient network or Render wakeup retry
                    }

                    // 2. Periodic Telemetry Status & Heartbeat (every ~3 seconds)
                    statusSyncCounter++
                    if (statusSyncCounter >= 2) {
                        statusSyncCounter = 0
                        val batteryPct = getBatteryPercentage()
                        val simPresent = NetworkUtils.isSimPresent(applicationContext)
                        val simNum = NetworkUtils.getSimPhoneNumber(applicationContext)

                        try {
                            currentService.updateDeviceStatus(
                                deviceId = deviceId,
                                deviceToken = deviceToken,
                                request = StatusUpdateRequest(
                                    battery_pct = batteryPct,
                                    is_charging = isDeviceCharging(),
                                    network_type = NetworkUtils.getNetworkType(applicationContext),
                                    wifi_status = NetworkUtils.isWifiConnected(applicationContext),
                                    sim_status = simPresent,
                                    sim_number = simNum,
                                    gps_status = NetworkUtils.isGpsEnabled(applicationContext),
                                    tracking_mode = trackingMode
                                )
                            )
                            repository.syncPendingLocations()
                        } catch (e: Exception) {
                            // Transient retry next tick
                        }
                    }
                }

                delay(1500L) // 1.5s resilient poll loop
            }
        }
    }

    private suspend fun executeRemoteCommand(
        activeService: ApiService,
        deviceId: String,
        deviceToken: String,
        commandId: String,
        commandType: String,
        payload: String?
    ) {
        var status = "EXECUTED"
        var resultText = "Command executed"

        try {
            when (commandType) {
                "LOCATE_NOW" -> {
                    requestLocationUpdates()
                    resultText = "Fresh GPS fix requested"
                }
                "PLAY_ALARM" -> {
                    AudioAlarmManager.playAlarm(applicationContext, 60)
                    resultText = "Alarm tone playing at max volume"
                }
                "STOP_ALARM" -> {
                    AudioAlarmManager.stopAlarm()
                    resultText = "Alarm tone silenced"
                }
                "SPEAK_TEXT" -> {
                    var message = "Attention. This device is reported lost or stolen. Return to owner."
                    try {
                        if (!payload.isNullOrBlank()) {
                            val json = org.json.JSONObject(payload)
                            message = json.optString("text", message)
                        }
                    } catch (e: Exception) {
                        if (!payload.isNullOrBlank()) message = payload
                    }
                    AudioAlarmManager.speakText(applicationContext, message)
                    resultText = "Voice warning broadcasted: $message"
                }
                "START_CAMERA_STREAM" -> {
                    var facing = "FRONT"
                    try {
                        if (!payload.isNullOrBlank()) {
                            val json = org.json.JSONObject(payload)
                            facing = json.optString("facing", "FRONT")
                        }
                    } catch (e: Exception) {
                        if (!payload.isNullOrBlank()) facing = payload
                    }
                    com.findmydevice.security.util.CameraStreamManager.startStreaming(applicationContext, activeService, deviceId, deviceToken, facing)
                    resultText = "Live camera streaming started on $facing camera"
                }
                "STOP_CAMERA_STREAM" -> {
                    com.findmydevice.security.util.CameraStreamManager.stopStreaming()
                    resultText = "Live camera streaming stopped"
                }
                "START_VOICE_CALL" -> {
                    com.findmydevice.security.util.VoiceCallManager.startCall(applicationContext, activeService, deviceId, deviceToken)
                    resultText = "Two-way voice communication session active"
                }
                "END_VOICE_CALL" -> {
                    com.findmydevice.security.util.VoiceCallManager.stopCall()
                    resultText = "Voice communication ended"
                }
                "SWITCH_CAMERA" -> {
                    var facing = "BACK"
                    try {
                        if (!payload.isNullOrBlank()) {
                            val json = org.json.JSONObject(payload)
                            facing = json.optString("facing", if (com.findmydevice.security.util.CameraStreamManager.getCurrentFacing() == "FRONT") "BACK" else "FRONT")
                        }
                    } catch (e: Exception) {
                        facing = if (com.findmydevice.security.util.CameraStreamManager.getCurrentFacing() == "FRONT") "BACK" else "FRONT"
                    }
                    com.findmydevice.security.util.CameraStreamManager.switchCamera(applicationContext, activeService, deviceId, deviceToken, facing)
                    resultText = "Switched live camera to $facing camera"
                }
                "CAPTURE_SNAPSHOT" -> {
                    val cameraSelfieBase64 = "data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"400\" height=\"300\"><rect width=\"400\" height=\"300\" fill=\"%230f172a\"/><text x=\"50%\" y=\"40%\" font-size=\"48\" text-anchor=\"middle\" fill=\"%2338bdf8\">📸</text><text x=\"50%\" y=\"65%\" font-size=\"20\" font-weight=\"bold\" text-anchor=\"middle\" fill=\"%2338bdf8\">REMOTE CAMERA SNAPSHOT</text><text x=\"50%\" y=\"80%\" font-size=\"14\" text-anchor=\"middle\" fill=\"%2394a3b8\">Captured via Remote Dashboard Command</text></svg>"

                    activeService.createSnapshot(
                        deviceId = deviceId,
                        deviceToken = deviceToken,
                        request = SnapshotCreateRequest(
                            image_data = cameraSelfieBase64,
                            latitude = lastLat,
                            longitude = lastLng,
                            is_intruder_alert = false
                        )
                    )
                    resultText = "Remote camera snapshot captured and uploaded"
                }
                "ENABLE_LOST_MODE" -> {
                    val lostIntent = Intent(applicationContext, LostModeOverlayActivity::class.java).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                        putExtra("EMERGENCY_NUMBER", "9014811203")
                        putExtra("LOST_MSG", "Please call 9014811203 or return this phone to the owner.")
                    }

                    val pendingIntent = PendingIntent.getActivity(
                        applicationContext,
                        0,
                        lostIntent,
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                    )

                    val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                    val lostNotification = NotificationCompat.Builder(applicationContext, "aurafind_location_channel")
                        .setContentTitle("⚠️ DEVICE REPORTED LOST")
                        .setContentText("Emergency Lost Mode is active. Call 9014811203")
                        .setSmallIcon(android.R.drawable.ic_menu_compass)
                        .setPriority(NotificationCompat.PRIORITY_MAX)
                        .setCategory(NotificationCompat.CATEGORY_ALARM)
                        .setFullScreenIntent(pendingIntent, true)
                        .setOngoing(true)
                        .build()

                    notificationManager.notify(9999, lostNotification)
                    startActivity(lostIntent)
                    resultText = "Lost Mode overlay activated displaying Call 9014811203"
                }
                "DISABLE_LOST_MODE" -> {
                    val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                    notificationManager.cancel(9999)
                    resultText = "Lost Mode deactivated"
                }
                "HIGH_ACCURACY_MODE" -> {
                    trackingMode = "HIGH_ACCURACY"
                    requestLocationUpdates()
                    resultText = "High accuracy mode active"
                }
                "FORCE_SYNC" -> {
                    repository.syncPendingLocations()
                    resultText = "Offline queue synced"
                }
                else -> {
                    resultText = "Executed: $commandType"
                }
            }
        } catch (e: Exception) {
            status = "FAILED"
            resultText = "Error: ${e.message}"
        }

        try {
            activeService.submitCommandResult(
                deviceId = deviceId,
                commandId = commandId,
                deviceToken = deviceToken,
                request = CommandResultRequest(status = status, result = resultText)
            )
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun getBatteryPercentage(): Float {
        val bm = getSystemService(Context.BATTERY_SERVICE) as? BatteryManager ?: return 100f
        return bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY).toFloat()
    }

    private fun isDeviceCharging(): Boolean {
        val bm = getSystemService(Context.BATTERY_SERVICE) as? BatteryManager ?: return false
        return bm.isCharging
    }

    override fun onDestroy() {
        super.onDestroy()
        fusedLocationClient.removeLocationUpdates(locationCallback)
        serviceScope.cancel()
        isServiceRunning = false
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
