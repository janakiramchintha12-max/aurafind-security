package com.findmydevice.security.service

import android.app.Notification
import android.content.Context
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import com.findmydevice.security.data.network.ApiService
import com.findmydevice.security.data.network.ChildNotificationDto
import com.findmydevice.security.data.network.NotificationBatchRequest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.text.SimpleDateFormat
import java.util.*

/**
 * Child Safety Notification Guard.
 * Monitors incoming alerts from social & messaging apps (WhatsApp, Instagram, Discord, SMS, YouTube)
 * and relays alert metadata to the Parent Web Dashboard for cyber safety protection.
 */
class ChildNotificationMonitorService : NotificationListenerService() {

    companion object {
        private const val TAG = "ChildNotificationGuard"
    }

    private val serviceScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var apiService: ApiService? = null

    private fun getApiService(): ApiService {
        if (apiService == null) {
            val retrofit = Retrofit.Builder()
                .baseUrl("https://aurafind-security.onrender.com/")
                .addConverterFactory(GsonConverterFactory.create())
                .build()
            apiService = retrofit.create(ApiService::class.java)
        }
        return apiService!!
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        super.onNotificationPosted(sbn)
        if (sbn == null) return

        val pkg = sbn.packageName ?: return
        // Ignore self and ongoing low-importance system notifications
        if (pkg == packageName || pkg == "android" || pkg.contains("systemui")) return

        val extras = sbn.notification.extras ?: return
        val title = extras.getString(Notification.EXTRA_TITLE) ?: ""
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""

        if (title.isBlank() && text.isBlank()) return

        val pm = applicationContext.packageManager
        val appName = try {
            val appInfo = pm.getApplicationInfo(pkg, 0)
            pm.getApplicationLabel(appInfo).toString()
        } catch (e: Exception) {
            pkg
        }

        val prefs = applicationContext.getSharedPreferences("aurafind_prefs", Context.MODE_PRIVATE)
        val deviceId = prefs.getString("device_id", null) ?: return
        val deviceToken = prefs.getString("device_token", null) ?: return

        val timeIso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).format(Date())

        val notifDto = ChildNotificationDto(
            package_name = pkg,
            app_name = appName,
            title = title,
            text = text,
            timestamp = timeIso
        )

        serviceScope.launch {
            try {
                getApiService().submitNotifications(
                    deviceId = deviceId,
                    deviceToken = deviceToken,
                    request = NotificationBatchRequest(notifications = listOf(notifDto))
                )
                Log.i(TAG, "Relayed child alert: [$appName] $title: $text")
            } catch (e: Exception) {
                // quiet network retry
            }
        }
    }
}
