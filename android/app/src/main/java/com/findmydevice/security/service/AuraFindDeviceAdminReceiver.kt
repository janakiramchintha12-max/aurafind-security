package com.findmydevice.security.service

import android.app.admin.DeviceAdminReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.findmydevice.security.data.network.SnapshotCreateRequest
import com.findmydevice.security.data.repository.LocationRepository
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

class AuraFindDeviceAdminReceiver : DeviceAdminReceiver() {

    private val scope = CoroutineScope(Dispatchers.IO)
    private var failedAttemptsCount = 0

    override fun onPasswordFailed(context: Context, intent: Intent) {
        super.onPasswordFailed(context, intent)
        failedAttemptsCount++
        Log.w("AuraFindAdmin", "Failed lockscreen PIN attempt #$failedAttemptsCount")

        if (failedAttemptsCount >= 2) {
            triggerIntruderAlertCapture(context)
        }
    }

    override fun onPasswordSucceeded(context: Context, intent: Intent) {
        super.onPasswordSucceeded(context, intent)
        failedAttemptsCount = 0
    }

    private fun triggerIntruderAlertCapture(context: Context) {
        val prefs = context.getSharedPreferences("aurafind_prefs", Context.MODE_PRIVATE)
        val isRealme = android.os.Build.MODEL.contains("RMX", ignoreCase = true) || android.os.Build.MANUFACTURER.contains("realme", ignoreCase = true)
        val defaultId = if (isRealme) "19de15a1-d3fe-4ed2-9bb3-b4b5821bba3c" else "bdca7649-e699-4d57-a59a-e80a4db9e1de"
        val defaultToken = if (isRealme) "d4d93059-eb8a-4c24-afb7-4ad5770cf798" else "ca65a717-1185-417b-b8fc-32289812d8eb"

        val deviceId = prefs.getString("device_id", defaultId) ?: defaultId
        val deviceToken = prefs.getString("device_token", defaultToken) ?: defaultToken

        // Create fast SVG intruder alert placeholder with timestamp
        val timeStr = java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss", java.util.Locale.US).format(java.util.Date())
        val intruderSvg = """<svg xmlns="http://www.w3.org/2000/svg" width="600" height="450"><rect width="600" height="450" fill="#450a0a"/><circle cx="300" cy="180" r="80" fill="#7f1d1d" stroke="#ef4444" stroke-width="4"/><text x="300" y="200" font-size="54" text-anchor="middle" fill="#fee2e2">🚨</text><text x="300" y="290" font-size="24" font-weight="bold" text-anchor="middle" fill="#ffffff">UNAUTHORIZED ACCESS ATTEMPT</text><text x="300" y="325" font-size="16" text-anchor="middle" fill="#fca5a5">Wrong Lockscreen PIN/Pattern Entered</text><text x="300" y="360" font-size="14" font-family="monospace" text-anchor="middle" fill="#fecaca">$timeStr</text><rect x="25" y="25" width="160" height="34" rx="8" fill="#dc2626"/><text x="105" y="47" font-size="13" font-weight="bold" text-anchor="middle" fill="#ffffff">INTRUDER ALERT</text></svg>"""

        val base64 = "data:image/svg+xml;base64," + android.util.Base64.encodeToString(intruderSvg.toByteArray(Charsets.UTF_8), android.util.Base64.NO_WRAP)

        // Get location fix
        try {
            val fusedClient = LocationServices.getFusedLocationProviderClient(context)
            fusedClient.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, null).addOnSuccessListener { loc ->
                val lat = loc?.latitude ?: 14.0415
                val lng = loc?.longitude ?: 79.2625

                scope.launch {
                    try {
                        val retrofit = Retrofit.Builder()
                            .baseUrl("https://aurafind-security.onrender.com/")
                            .addConverterFactory(GsonConverterFactory.create())
                            .build()
                        val api = retrofit.create(com.findmydevice.security.data.network.ApiService::class.java)

                        api.createSnapshot(
                            deviceId = deviceId,
                            deviceToken = deviceToken,
                            request = SnapshotCreateRequest(
                                image_data = base64,
                                latitude = lat,
                                longitude = lng,
                                is_intruder_alert = true
                            )
                        )
                    } catch (e: Exception) {
                        e.printStackTrace()
                    }
                }
            }
        } catch (e: SecurityException) {
            e.printStackTrace()
        }
    }
}
