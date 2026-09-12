package com.findmydevice.security.util

import android.app.AppOpsManager
import android.app.usage.UsageStats
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import android.os.Process
import android.util.Log
import com.findmydevice.security.data.network.ApiService
import com.findmydevice.security.data.network.AppUsageItemDto
import com.findmydevice.security.data.network.AppUsageReportRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.*

/**
 * Parental Control App Usage & Screen Time Monitor.
 * Queries UsageStatsManager for daily screen time breakdown and app usage analytics.
 */
object ChildAppUsageManager {

    private const val TAG = "ChildAppUsageManager"

    fun hasUsageStatsPermission(context: Context): Boolean {
        val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as? AppOpsManager ?: return false
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            appOps.unsafeCheckOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                context.packageName
            )
        } else {
            @Suppress("DEPRECATION")
            appOps.checkOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                context.packageName
            )
        }
        return mode == AppOpsManager.MODE_ALLOWED
    }

    suspend fun fetchAndUploadAppUsage(
        context: Context,
        apiService: ApiService,
        deviceId: String,
        deviceToken: String
    ): Boolean = withContext(Dispatchers.IO) {
        if (!hasUsageStatsPermission(context)) {
            Log.w(TAG, "PACKAGE_USAGE_STATS permission not granted.")
            return@withContext false
        }

        val usageStatsManager = context.getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager
            ?: return@withContext false

        val cal = Calendar.getInstance()
        cal.set(Calendar.HOUR_OF_DAY, 0)
        cal.set(Calendar.MINUTE, 0)
        cal.set(Calendar.SECOND, 0)
        val startOfDay = cal.timeInMillis
        val now = System.currentTimeMillis()

        val usageStatsList: List<UsageStats> = usageStatsManager.queryUsageStats(
            UsageStatsManager.INTERVAL_DAILY,
            startOfDay,
            now
        ) ?: emptyList()

        val pm = context.packageManager
        val items = mutableListOf<AppUsageItemDto>()
        var totalScreenTimeSecs = 0

        val dateFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }

        for (stats in usageStatsList) {
            val foregroundSecs = (stats.totalTimeInForeground / 1000).toInt()
            if (foregroundSecs > 10) { // Filter out negligible usage (<10s)
                val appName = try {
                    val appInfo = pm.getApplicationInfo(stats.packageName, 0)
                    pm.getApplicationLabel(appInfo).toString()
                } catch (e: Exception) {
                    stats.packageName
                }

                // Exclude system background utilities
                if (stats.packageName == "android" || stats.packageName.contains("systemui")) continue

                totalScreenTimeSecs += foregroundSecs
                items.add(
                    AppUsageItemDto(
                        package_name = stats.packageName,
                        app_name = appName,
                        total_time_foreground_seconds = foregroundSecs,
                        last_time_used = dateFormat.format(Date(stats.lastTimeUsed))
                    )
                )
            }
        }

        items.sortByDescending { it.total_time_foreground_seconds }

        val todayDate = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
        val report = AppUsageReportRequest(
            date = todayDate,
            total_screen_time_seconds = totalScreenTimeSecs,
            apps = items.take(25) // Top 25 apps
        )

        return@withContext try {
            val response = apiService.submitAppUsage(deviceId, deviceToken, report)
            if (response.isSuccessful) {
                Log.i(TAG, "Uploaded Child App Usage Report: ${items.size} apps, total screen time: ${totalScreenTimeSecs}s")
                true
            } else {
                false
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error uploading app usage report: ${e.message}")
            false
        }
    }
}
