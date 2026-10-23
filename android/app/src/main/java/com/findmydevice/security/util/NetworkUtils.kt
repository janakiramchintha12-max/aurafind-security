package com.findmydevice.security.util

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.location.LocationManager
import android.os.Build
import android.telephony.SubscriptionInfo
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat

data class SimCardDetail(
    val slotIndex: Int,
    val carrierName: String,
    val displayName: String,
    val phoneNumber: String?,
    val countryIso: String?
)

data class SimStatusResult(
    val isSimPresent: Boolean,
    val simCount: Int,
    val summary: String,
    val isSimSwapped: Boolean,
    val previousSim: String?,
    val cards: List<SimCardDetail>
)

object NetworkUtils {
    const val DEFAULT_CLOUD_URL = "https://aurafind-security.onrender.com/"

    @Volatile
    private var customBaseUrl: String? = null

    val BASE_URL: String
        get() = customBaseUrl ?: DEFAULT_CLOUD_URL

    fun setServerUrl(url: String) {
        var clean = url.trim()
        if (!clean.endsWith("/")) clean += "/"
        customBaseUrl = clean
    }

    fun init(context: Context) {
        val prefs = context.getSharedPreferences("aurafind_prefs", Context.MODE_PRIVATE)
        val saved = prefs.getString("server_url", null)
        if (saved.isNullOrBlank() || saved.contains("192.168.31.94")) {
            prefs.edit().putString("server_url", DEFAULT_CLOUD_URL).apply()
            setServerUrl(DEFAULT_CLOUD_URL)
        } else {
            setServerUrl(saved)
        }
        // Ensure unique hardware-derived device credentials are initialized
        getHardwareDeviceId(context)
        getHardwareDeviceToken(context)
    }

    fun getHardwareDeviceId(context: Context): String {
        val prefs = context.getSharedPreferences("aurafind_prefs", Context.MODE_PRIVATE)
        val existing = prefs.getString("device_id", null)
        val model = (Build.MODEL ?: "Android").trim()
        // Keep canonical ID for moto g57 power so existing dashboard card seamlessly updates
        if (model.equals("moto g57 power", ignoreCase = true)) {
            val canonicalId = "67bfe7a4-2b79-4bde-958a-2dd15529ee30"
            if (existing.isNullOrBlank() || existing == canonicalId) {
                prefs.edit().putString("device_id", canonicalId).apply()
                return canonicalId
            }
        }
        val androidId = try {
            android.provider.Settings.Secure.getString(context.contentResolver, android.provider.Settings.Secure.ANDROID_ID) ?: "unknown"
        } catch (_: Exception) { "unknown" }
        val hwId = java.util.UUID.nameUUIDFromBytes("aurafind-hw-$androidId-$model-${Build.BRAND}".toByteArray()).toString()
        if (existing.isNullOrBlank() || existing == "67bfe7a4-2b79-4bde-958a-2dd15529ee30") {
            prefs.edit().putString("device_id", hwId).apply()
            return hwId
        }
        return existing
    }

    fun getHardwareDeviceToken(context: Context): String {
        val prefs = context.getSharedPreferences("aurafind_prefs", Context.MODE_PRIVATE)
        val existing = prefs.getString("device_token", null)
        val model = (Build.MODEL ?: "Android").trim()
        if (model.equals("moto g57 power", ignoreCase = true)) {
            val canonicalTok = "d08a8f7f-ec74-4055-90d0-8a4d302e066f"
            if (existing.isNullOrBlank() || existing == canonicalTok) {
                prefs.edit().putString("device_token", canonicalTok).apply()
                return canonicalTok
            }
        }
        val androidId = try {
            android.provider.Settings.Secure.getString(context.contentResolver, android.provider.Settings.Secure.ANDROID_ID) ?: "unknown"
        } catch (_: Exception) { "unknown" }
        val hwTok = java.util.UUID.nameUUIDFromBytes("aurafind-tok-$androidId-$model".toByteArray()).toString()
        if (existing.isNullOrBlank() || existing == "d08a8f7f-ec74-4055-90d0-8a4d302e066f") {
            prefs.edit().putString("device_token", hwTok).apply()
            return hwTok
        }
        return existing
    }

    fun getHardwareDeviceName(): String {
        val brand = (Build.MANUFACTURER ?: "").trim()
        val model = (Build.MODEL ?: "Android Handset").trim()
        return if (model.startsWith(brand, ignoreCase = true) || brand.isBlank()) {
            model
        } else {
            "${brand.replaceFirstChar { it.uppercase() }} $model"
        }
    }

    fun isNetworkAvailable(context: Context): Boolean {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return false
        val activeNetwork = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(activeNetwork) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
               caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    }

    fun getNetworkType(context: Context): String {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return "NONE"
        val activeNetwork = cm.activeNetwork ?: return "NONE"
        val caps = cm.getNetworkCapabilities(activeNetwork) ?: return "NONE"

        return when {
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "WIFI"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "CELLULAR"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ETHERNET"
            else -> "UNKNOWN"
        }
    }

    fun isWifiConnected(context: Context): Boolean {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return false
        val activeNetwork = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(activeNetwork) ?: return false
        return caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
    }

    fun isSimPresent(context: Context): Boolean {
        return getSimDetails(context).isSimPresent
    }

    fun getSimDetails(context: Context): SimStatusResult {
        val prefs = context.getSharedPreferences("aurafind_prefs", Context.MODE_PRIVATE)
        val tm = context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
        val hasPhonePermission = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.READ_PHONE_STATE
        ) == PackageManager.PERMISSION_GRANTED

        val cards = mutableListOf<SimCardDetail>()
        var isPresent = false

        if (hasPhonePermission) {
            try {
                val sm = context.getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE) as? SubscriptionManager
                val subList: List<SubscriptionInfo>? = sm?.activeSubscriptionInfoList
                if (!subList.isNullOrEmpty()) {
                    isPresent = true
                    for (sub in subList) {
                        val slot = sub.simSlotIndex
                        val carrier = sub.carrierName?.toString()?.trim()
                            ?.ifBlank { null }
                            ?: tm?.simOperatorName?.trim()?.ifBlank { null }
                            ?: "SIM Slot ${slot + 1}"
                        val display = sub.displayName?.toString()?.trim()
                            ?.ifBlank { null }
                            ?: carrier

                        var phoneNum: String? = null
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                            try {
                                val num = sm.getPhoneNumber(sub.subscriptionId)
                                if (!num.isNullOrBlank()) phoneNum = num.trim()
                            } catch (_: Exception) {}
                        }
                        if (phoneNum.isNullOrBlank()) {
                            @Suppress("DEPRECATION")
                            val num = sub.number
                            if (!num.isNullOrBlank()) phoneNum = num.trim()
                        }
                        if (phoneNum.isNullOrBlank() && slot == 0) {
                            @Suppress("DEPRECATION")
                            val line1 = tm?.line1Number
                            if (!line1.isNullOrBlank()) phoneNum = line1.trim()
                        }

                        cards.add(
                            SimCardDetail(
                                slotIndex = slot,
                                carrierName = carrier,
                                displayName = display,
                                phoneNumber = phoneNum,
                                countryIso = sub.countryIso?.uppercase()
                            )
                        )
                    }
                }
            } catch (_: Exception) {}
        }

        // Fallback to TelephonyManager if no subscription info list
        if (cards.isEmpty() && tm != null) {
            val state = tm.simState
            isPresent = state == TelephonyManager.SIM_STATE_READY
            if (isPresent) {
                val carrier = tm.simOperatorName?.trim()?.ifBlank { null }
                    ?: tm.networkOperatorName?.trim()?.ifBlank { null }
                    ?: "Active Cellular SIM"
                var line1: String? = null
                if (hasPhonePermission) {
                    try {
                        @Suppress("DEPRECATION")
                        line1 = tm.line1Number?.trim()?.ifBlank { null }
                    } catch (_: Exception) {}
                }
                cards.add(
                    SimCardDetail(
                        slotIndex = 0,
                        carrierName = carrier,
                        displayName = carrier,
                        phoneNumber = line1,
                        countryIso = tm.simCountryIso?.uppercase()
                    )
                )
            }
        }

        // Build clean human-readable summary
        val baseSummary = if (cards.isEmpty()) {
            if (isPresent) "Active SIM" else "No SIM Card Inserted"
        } else if (cards.size == 1) {
            val c = cards[0]
            val numStr = if (!c.phoneNumber.isNullOrBlank()) " (${c.phoneNumber})" else ""
            "${c.displayName}$numStr"
        } else {
            cards.joinToString(" | ") { c ->
                val numStr = if (!c.phoneNumber.isNullOrBlank()) " (${c.phoneNumber})" else ""
                "SIM ${c.slotIndex + 1}: ${c.displayName}$numStr"
            }
        }

        // SIM Swap / Change Detection
        val currentSignature = if (cards.isEmpty()) "NO_SIM" else cards.joinToString(";") {
            "${it.slotIndex}:${it.carrierName}:${it.displayName}:${it.phoneNumber ?: "NONE"}"
        }

        val lastSignature = prefs.getString("last_known_sim_sig", null)
        val lastSimName = prefs.getString("last_known_sim_name", null)
        var isSwapped = false

        if (lastSignature != null && lastSignature != "NO_SIM" && currentSignature != "NO_SIM") {
            if (lastSignature != currentSignature) {
                isSwapped = true
                prefs.edit()
                    .putBoolean("sim_swapped_flag", true)
                    .putString("last_known_sim_sig", currentSignature)
                    .putString("last_known_sim_name", baseSummary)
                    .putString("previous_swapped_sim", lastSimName ?: "Original SIM")
                    .apply()
            }
        } else if (lastSignature == null && currentSignature != "NO_SIM") {
            prefs.edit()
                .putString("last_known_sim_sig", currentSignature)
                .putString("last_known_sim_name", baseSummary)
                .apply()
        }

        val wasEverSwapped = prefs.getBoolean("sim_swapped_flag", false) || isSwapped
        val prevSimName = prefs.getString("previous_swapped_sim", null)

        val finalSummary = if (wasEverSwapped && isPresent) {
            "⚠️ SWAPPED: $baseSummary"
        } else {
            baseSummary
        }

        return SimStatusResult(
            isSimPresent = isPresent,
            simCount = cards.size,
            summary = finalSummary,
            isSimSwapped = wasEverSwapped,
            previousSim = prevSimName,
            cards = cards
        )
    }

    fun getSimPhoneNumber(context: Context): String {
        return getSimDetails(context).summary
    }

    fun resetSimSwappedState(context: Context) {
        val prefs = context.getSharedPreferences("aurafind_prefs", Context.MODE_PRIVATE)
        val current = getSimDetails(context)
        prefs.edit()
            .putBoolean("sim_swapped_flag", false)
            .remove("previous_swapped_sim")
            .putString("last_known_sim_name", current.summary.replace("⚠️ SWAPPED: ", ""))
            .apply()
    }

    fun isGpsEnabled(context: Context): Boolean {
        val lm = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return false
        return lm.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
               lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
    }
}
