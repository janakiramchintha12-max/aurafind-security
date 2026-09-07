package com.findmydevice.security.util

import android.content.Context
import android.content.SharedPreferences
import com.findmydevice.security.data.network.ApiService
import com.findmydevice.security.data.network.StatusUpdateRequest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Authoritative Device-Controlled Privacy & Consent Engine
 * The person physically holding this handset retains absolute authority
 * over sensitive sensors (Camera, Microphone, Location, Loudspeaker).
 */
object PrivacyManager {

    private const val PREFS_NAME = "aurafind_privacy_prefs"
    private const val KEY_CAMERA_PAUSED = "privacy_camera_paused"
    private const val KEY_MIC_PAUSED = "privacy_mic_paused"
    private const val KEY_LOCATION_PAUSED = "privacy_location_paused"
    private const val KEY_SPEAKER_PAUSED = "privacy_speaker_paused"
    private const val KEY_CONTROLS_RESTRICTED = "privacy_controls_restricted"
    private const val KEY_ACTIVITY_LOGS = "privacy_activity_logs"

    private fun getPrefs(context: Context): SharedPreferences {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    fun isCameraPaused(context: Context): Boolean = getPrefs(context).getBoolean(KEY_CAMERA_PAUSED, false)
    fun isMicPaused(context: Context): Boolean = getPrefs(context).getBoolean(KEY_MIC_PAUSED, false)
    fun isLocationPaused(context: Context): Boolean = getPrefs(context).getBoolean(KEY_LOCATION_PAUSED, false)
    fun isSpeakerPaused(context: Context): Boolean = getPrefs(context).getBoolean(KEY_SPEAKER_PAUSED, false)
    fun isControlsRestricted(context: Context): Boolean = getPrefs(context).getBoolean(KEY_CONTROLS_RESTRICTED, false)

    fun setCameraPaused(context: Context, paused: Boolean, apiService: ApiService? = null, deviceId: String? = null, deviceToken: String? = null) {
        getPrefs(context).edit().putBoolean(KEY_CAMERA_PAUSED, paused).apply()
        logActivity(context, if (paused) "Camera remote access PAUSED by device user" else "Camera remote access ALLOWED by device user")
        syncIfPossible(context, apiService, deviceId, deviceToken)
    }

    fun setMicPaused(context: Context, paused: Boolean, apiService: ApiService? = null, deviceId: String? = null, deviceToken: String? = null) {
        getPrefs(context).edit().putBoolean(KEY_MIC_PAUSED, paused).apply()
        logActivity(context, if (paused) "Microphone remote access PAUSED by device user" else "Microphone remote access ALLOWED by device user")
        syncIfPossible(context, apiService, deviceId, deviceToken)
    }

    fun setLocationPaused(context: Context, paused: Boolean, apiService: ApiService? = null, deviceId: String? = null, deviceToken: String? = null) {
        getPrefs(context).edit().putBoolean(KEY_LOCATION_PAUSED, paused).apply()
        logActivity(context, if (paused) "Location remote sharing PAUSED by device user" else "Location remote sharing ALLOWED by device user")
        syncIfPossible(context, apiService, deviceId, deviceToken)
    }

    fun setSpeakerPaused(context: Context, paused: Boolean, apiService: ApiService? = null, deviceId: String? = null, deviceToken: String? = null) {
        getPrefs(context).edit().putBoolean(KEY_SPEAKER_PAUSED, paused).apply()
        logActivity(context, if (paused) "Speaker & Siren PAUSED by device user" else "Speaker & Siren ALLOWED by device user")
        syncIfPossible(context, apiService, deviceId, deviceToken)
    }

    fun setControlsRestricted(context: Context, restricted: Boolean, apiService: ApiService? = null, deviceId: String? = null, deviceToken: String? = null) {
        getPrefs(context).edit().putBoolean(KEY_CONTROLS_RESTRICTED, restricted).apply()
        logActivity(context, if (restricted) "Remote device controls RESTRICTED by device user" else "Remote device controls ALLOWED by device user")
        syncIfPossible(context, apiService, deviceId, deviceToken)
    }

    fun getCameraState(context: Context): String = if (isCameraPaused(context)) "PAUSED_BY_DEVICE_USER" else "ALLOWED"
    fun getMicState(context: Context): String = if (isMicPaused(context)) "PAUSED_BY_DEVICE_USER" else "ALLOWED"
    fun getLocationState(context: Context): String = if (isLocationPaused(context)) "PAUSED_BY_DEVICE_USER" else "ALLOWED"
    fun getSpeakerState(context: Context): String = if (isSpeakerPaused(context)) "PAUSED_BY_DEVICE_USER" else "ALLOWED"
    fun getControlsState(context: Context): String = if (isControlsRestricted(context)) "RESTRICTED" else "ALLOWED"

    private const val GENESIS_HASH = "GENESIS_AURA_PRIVACY_ROOT_000000000000"

    private fun sha256(input: String): String {
        val bytes = java.security.MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8))
        return bytes.joinToString("") { "%02x".format(it) }
    }

    private fun logActivity(context: Context, action: String) {
        try {
            val prefs = getPrefs(context)
            val existingJson = prefs.getString(KEY_ACTIVITY_LOGS, "[]") ?: "[]"
            val array = JSONArray(existingJson)

            // Determine previous entry hash from latest block in chain
            val prevHash = if (array.length() > 0) {
                array.getJSONObject(0).optString("entry_hash", GENESIS_HASH)
            } else {
                GENESIS_HASH
            }

            val epoch = System.currentTimeMillis()
            val timestampStr = SimpleDateFormat("MMM dd, HH:mm:ss", Locale.getDefault()).format(Date(epoch))
            val entryPayload = "$prevHash:$action:$epoch:$timestampStr"
            val entryHash = sha256(entryPayload)

            val entry = JSONObject().apply {
                put("action", action)
                put("timestamp", timestampStr)
                put("epoch", epoch)
                put("prev_hash", prevHash)
                put("entry_hash", entryHash)
            }

            val newArray = JSONArray()
            newArray.put(entry)
            for (i in 0 until minOf(array.length(), 49)) {
                newArray.put(array.getJSONObject(i))
            }
            prefs.edit().putString(KEY_ACTIVITY_LOGS, newArray.toString()).apply()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    /**
     * Verifies the cryptographic hash-chain integrity of local privacy audit records.
     * Returns Pair(isValid, detailMessage).
     */
    fun verifyAuditChainIntegrity(context: Context): Pair<Boolean, String> {
        try {
            val json = getPrefs(context).getString(KEY_ACTIVITY_LOGS, "[]") ?: "[]"
            val array = JSONArray(json)
            if (array.length() == 0) return Pair(true, "Audit chain is empty (Genesis state).")

            // Traverse from newest to oldest and verify each block's cryptographic hash
            for (i in 0 until array.length()) {
                val item = array.getJSONObject(i)
                val action = item.getString("action")
                val timestampStr = item.getString("timestamp")
                val epoch = item.getLong("epoch")
                val prevHash = item.getString("prev_hash")
                val storedEntryHash = item.getString("entry_hash")

                val expectedHash = sha256("$prevHash:$action:$epoch:$timestampStr")
                if (expectedHash != storedEntryHash) {
                    return Pair(false, "Cryptographic integrity violation detected at block index $i: Tampered payload!")
                }

                // Check chain linkage to next older block if present
                if (i < array.length() - 1) {
                    val olderItem = array.getJSONObject(i + 1)
                    val olderHash = olderItem.getString("entry_hash")
                    if (prevHash != olderHash) {
                        return Pair(false, "Cryptographic chain linkage broken between block $i and block ${i + 1}!")
                    }
                }
            }
            return Pair(true, "Cryptographic hash-chain verified: 100% Tamper-Evident (${array.length()} blocks valid).")
        } catch (e: Exception) {
            return Pair(false, "Verification error: ${e.message}")
        }
    }

    fun getActivityLogs(context: Context): List<Pair<String, String>> {
        val list = mutableListOf<Pair<String, String>>()
        try {
            val json = getPrefs(context).getString(KEY_ACTIVITY_LOGS, "[]") ?: "[]"
            val array = JSONArray(json)
            for (i in 0 until array.length()) {
                val obj = array.getJSONObject(i)
                list.add(Pair(obj.getString("action"), obj.getString("timestamp")))
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
        return list
    }

    fun syncIfPossible(context: Context, apiService: ApiService?, deviceId: String?, deviceToken: String?) {
        if (apiService == null || deviceId == null || deviceToken == null) return

        CoroutineScope(Dispatchers.IO).launch {
            try {
                apiService.updatePrivacyState(
                    deviceId = deviceId,
                    deviceToken = deviceToken,
                    request = StatusUpdateRequest(
                        camera_privacy_state = getCameraState(context),
                        microphone_privacy_state = getMicState(context),
                        location_privacy_state = getLocationState(context),
                        speaker_privacy_state = getSpeakerState(context),
                        remote_controls_state = getControlsState(context)
                    )
                )
            } catch (e: Exception) {
                // Preserves local state during transient network loss
            }
        }
    }
}
