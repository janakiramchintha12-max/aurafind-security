package com.findmydevice.security.offline

import android.content.Context
import android.util.Log
import com.findmydevice.security.offline.ble.BleAdvertiserManager
import com.findmydevice.security.offline.ble.BleScannerManager
import com.findmydevice.security.offline.network.NetworkMonitor
import com.findmydevice.security.offline.sms.SmsFallbackManager
import com.findmydevice.security.offline.storage.OfflineQueueRepository
import com.findmydevice.security.offline.storage.PayloadType
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.collectLatest

/**
 * Module 4: Unified Offline Safety Coordinator
 * Orchestrates network state transitions across SMS Coordinate Fallback,
 * Store-and-Forward Local Logging, and Bluetooth LE Mesh Beacon subsystems.
 */
class OfflineSafetyCoordinator(private val context: Context) {

    companion object {
        private const val TAG = "OfflineSafetyCoordinator"
    }

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    
    private val networkMonitor = NetworkMonitor(context)
    val smsFallbackManager = SmsFallbackManager(context)
    val offlineQueueRepository = OfflineQueueRepository(context)
    val bleAdvertiserManager = BleAdvertiserManager(context)
    val bleScannerManager = BleScannerManager(context, offlineQueueRepository)

    private var isStarted = false
    private var lastKnownLat: Double = 0.0
    private var lastKnownLng: Double = 0.0
    private var isOfflineState = false

    /**
     * Initializes network listeners and starts background coordination.
     */
    fun start() {
        if (isStarted) return
        isStarted = true

        Log.i(TAG, "Initializing Unified Offline Safety Coordinator...")

        // Always run BLE mesh scanner to assist neighboring devices
        try {
            bleScannerManager.startScanning()
        } catch (e: Exception) {
            Log.e(TAG, "Error starting BLE scanner", e)
        }

        scope.launch {
            networkMonitor.isOnline.collectLatest { isOnline ->
                handleNetworkStateChange(isOnline)
            }
        }
    }

    private suspend fun handleNetworkStateChange(isOnline: Boolean) {
        val prefs = context.getSharedPreferences("aurafind_prefs", Context.MODE_PRIVATE)
        val deviceId = prefs.getString("device_id", "AuraFindDevice") ?: "AuraFindDevice"
        val emergencyNumber = prefs.getString("emergency_number", "") ?: ""

        if (!isOnline) {
            isOfflineState = true
            Log.w(TAG, "[NETWORK OFFLINE DETECTED] Engaging emergency offline safety protocols.")

            // 1. Enqueue offline event log
            offlineQueueRepository.enqueueTamperEvent(
                eventType = "NETWORK_LOST",
                details = "Cellular and Wi-Fi data disconnected at lat: $lastKnownLat, lng: $lastKnownLng"
            )

            // 2. Transmit Emergency Silent SMS Fallback (GPS coordinates)
            if (emergencyNumber.isNotBlank()) {
                smsFallbackManager.triggerOfflineLocationSms(
                    emergencyPhoneNumber = emergencyNumber,
                    deviceId = deviceId
                )
            }

            // 3. Start BLE Offline Proximity Mesh Beacon Broadcast
            if (lastKnownLat != 0.0 && lastKnownLng != 0.0) {
                bleAdvertiserManager.startAdvertising(
                    latitude = lastKnownLat,
                    longitude = lastKnownLng,
                    deviceId = deviceId
                )
            }

        } else {
            val wasOffline = isOfflineState
            isOfflineState = false

            if (wasOffline) {
                Log.i(TAG, "[NETWORK RESTORED] Terminating BLE beacon broadcast and scheduling store-and-forward sync.")
            }

            // Halt BLE broadcast once back online
            bleAdvertiserManager.stopAdvertising()

            // Drain & sync all queued offline payloads via WorkManager
            offlineQueueRepository.scheduleSyncJob()
        }
    }

    /**
     * Feeds fresh GPS fixes to update BLE beacon broadcast payload.
     */
    fun updateCoordinates(latitude: Double, longitude: Double) {
        lastKnownLat = latitude
        lastKnownLng = longitude

        if (isOfflineState && bleAdvertiserManager.isAdvertising()) {
            val prefs = context.getSharedPreferences("aurafind_prefs", Context.MODE_PRIVATE)
            val deviceId = prefs.getString("device_id", "AuraFindDevice") ?: "AuraFindDevice"
            bleAdvertiserManager.updateCoordinates(latitude, longitude, deviceId)
        }
    }

    /**
     * Buffers offline location fixes to Room.
     */
    fun recordOfflineLocation(latitude: Double, longitude: Double, accuracy: Float) {
        scope.launch {
            offlineQueueRepository.enqueueLocation(latitude, longitude, accuracy)
        }
    }

    /**
     * Buffers offline media files (Audio recordings / Snapshots) to Room.
     */
    fun recordOfflineMedia(filePath: String, type: PayloadType, metadataJson: String = "{}") {
        scope.launch {
            offlineQueueRepository.enqueueMediaFile(filePath, type, metadataJson)
        }
    }

    /**
     * Stops the coordinator and releases all BLE transmitters and scanners.
     */
    fun stop() {
        isStarted = false
        bleAdvertiserManager.stopAdvertising()
        bleScannerManager.stopScanning()
        scope.cancel()
        Log.i(TAG, "Offline Safety Coordinator stopped.")
    }
}
