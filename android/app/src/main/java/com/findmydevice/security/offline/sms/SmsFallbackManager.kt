package com.findmydevice.security.offline.sms

import android.annotation.SuppressLint
import android.content.Context
import android.os.Build
import android.telephony.SmsManager
import android.util.Log
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import kotlinx.coroutines.tasks.await
import java.text.SimpleDateFormat
import java.util.*

/**
 * Module 1: SMS Coordinate Fallback Engine
 * Automatically acquires real-time GPS coordinates via FusedLocationProviderClient
 * and sends an emergency SMS with Google Maps hyperlink to a designated contact.
 */
class SmsFallbackManager(private val context: Context) {

    companion object {
        private const val TAG = "SmsFallbackManager"
        private const val MIN_SMS_INTERVAL_MS = 5 * 60 * 1000L // Anti-flood: max 1 SMS every 5 mins
    }

    private val fusedLocationClient: FusedLocationProviderClient =
        LocationServices.getFusedLocationProviderClient(context)

    private var lastSmsTimestamp = 0L

    @SuppressLint("MissingPermission")
    suspend fun triggerOfflineLocationSms(emergencyPhoneNumber: String, deviceId: String) {
        val now = System.currentTimeMillis()
        if (now - lastSmsTimestamp < MIN_SMS_INTERVAL_MS) {
            Log.w(TAG, "SMS fallback suppressed by anti-flood rate-limiting cooldown.")
            return
        }

        if (emergencyPhoneNumber.isBlank()) {
            Log.w(TAG, "No emergency phone number configured for SMS coordinate fallback.")
            return
        }

        try {
            // 1. Fetch current GPS position
            val cts = CancellationTokenSource()
            val location = try {
                fusedLocationClient.getCurrentLocation(
                    Priority.PRIORITY_HIGH_ACCURACY,
                    cts.token
                ).await()
            } catch (e: Exception) {
                null
            } ?: try {
                fusedLocationClient.lastLocation.await()
            } catch (e: Exception) {
                null
            }

            if (location == null) {
                Log.e(TAG, "Unable to obtain GPS fix for SMS fallback.")
                return
            }

            // 2. Format a compact, clear emergency SMS
            val timeString = SimpleDateFormat("HH:mm:ss", Locale.US).format(Date(location.time))
            val mapsLink = "https://maps.google.com/?q=${location.latitude},${location.longitude}"
            val message = "🚨 AURAFIND OFFLINE ALERT\n" +
                          "Dev: $deviceId\n" +
                          "Lat: ${location.latitude}\n" +
                          "Lon: ${location.longitude}\n" +
                          "Acc: ${location.accuracy}m\n" +
                          "Time: $timeString\n" +
                          "Map: $mapsLink"

            // 3. Dispatch SMS safely with modern API compatibility
            sendSms(emergencyPhoneNumber, message)
            lastSmsTimestamp = now
            Log.i(TAG, "Emergency offline SMS successfully dispatched to $emergencyPhoneNumber")

        } catch (e: Exception) {
            Log.e(TAG, "Error executing SMS coordinate fallback", e)
        }
    }

    private fun sendSms(destinationNumber: String, messageText: String) {
        try {
            val smsManager: SmsManager = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                context.getSystemService(SmsManager::class.java)
            } else {
                @Suppress("DEPRECATION")
                SmsManager.getDefault()
            }

            val parts = smsManager.divideMessage(messageText)
            if (parts.size > 1) {
                smsManager.sendMultipartTextMessage(destinationNumber, null, parts, null, null)
            } else {
                smsManager.sendTextMessage(destinationNumber, null, messageText, null, null)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to send SMS to $destinationNumber: ${e.message}")
        }
    }
}
