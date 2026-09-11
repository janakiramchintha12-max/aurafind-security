package com.findmydevice.security.offline.ble

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import com.findmydevice.security.offline.storage.OfflineQueueRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.util.concurrent.ConcurrentHashMap

/**
 * Module 3: BLE Offline Proximity Mesh Scanner
 * Scans for nearby offline beacons emitted by lost AuraFind devices,
 * decrypts coordinate payloads, and relays them to the central server or local offline buffer.
 */
class BleScannerManager(
    private val context: Context,
    private val offlineQueueRepository: OfflineQueueRepository
) {

    companion object {
        private const val TAG = "BleScannerManager"
        private const val REPORT_COOLDOWN_MS = 60_000L // 1 minute deduplication cooldown per peer
    }

    private val bluetoothManager: BluetoothManager? =
        context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    private val bluetoothAdapter: BluetoothAdapter? = bluetoothManager?.adapter
    private var scanner: BluetoothLeScanner? = null

    private var isCurrentlyScanning = false
    private var currentCallback: ScanCallback? = null
    private val scope = CoroutineScope(Dispatchers.IO)
    private val peerReportTimestamps = ConcurrentHashMap<Int, Long>()

    private fun hasRequiredPermissions(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
        } else {
            ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH) == PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_ADMIN) == PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        }
    }

    /**
     * Activates continuous background BLE scanning for nearby lost device beacons.
     */
    @SuppressLint("MissingPermission")
    fun startScanning() {
        if (!hasRequiredPermissions()) {
            Log.w(TAG, "Missing BLUETOOTH_SCAN permissions.")
            return
        }

        if (bluetoothAdapter == null || !bluetoothAdapter.isEnabled) {
            Log.w(TAG, "Bluetooth disabled; BLE scanning unavailable.")
            return
        }

        stopScanning()

        scanner = bluetoothAdapter.bluetoothLeScanner
        if (scanner == null) {
            Log.e(TAG, "BluetoothLeScanner instance is null.")
            return
        }

        val filter = ScanFilter.Builder()
            .setServiceUuid(BleAdvertiserManager.SERVICE_UUID)
            .build()

        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_POWER)
            .build()

        val callback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult?) {
                super.onScanResult(callbackType, result)
                result?.let { processScanResult(it) }
            }

            override fun onBatchScanResults(results: MutableList<ScanResult>?) {
                super.onBatchScanResults(results)
                results?.forEach { processScanResult(it) }
            }

            override fun onScanFailed(errorCode: Int) {
                super.onScanFailed(errorCode)
                Log.e(TAG, "BLE Scan failed with error code: $errorCode")
                isCurrentlyScanning = false
            }
        }

        currentCallback = callback
        try {
            scanner?.startScan(listOf(filter), settings, callback)
            isCurrentlyScanning = true
            Log.i(TAG, "BLE Mesh Scanner started successfully.")
        } catch (e: Exception) {
            Log.e(TAG, "Exception starting BLE scan", e)
            isCurrentlyScanning = false
        }
    }

    private fun processScanResult(result: ScanResult) {
        val record = result.scanRecord ?: return
        val serviceData = record.getServiceData(BleAdvertiserManager.SERVICE_UUID) ?: return

        val packet = BleCryptoUtils.decrypt(serviceData) ?: return
        val now = System.currentTimeMillis()
        val lastReport = peerReportTimestamps[packet.deviceIdHash] ?: 0L

        if (now - lastReport >= REPORT_COOLDOWN_MS) {
            peerReportTimestamps[packet.deviceIdHash] = now
            Log.i(TAG, "Discovered nearby lost device (Hash: ${packet.deviceIdHash}, Lat: ${packet.latitude}, Lon: ${packet.longitude}, RSSI: ${result.rssi} dBm)")

            scope.launch {
                // Relay nearby device's coordinates into store-and-forward queue
                offlineQueueRepository.enqueueLocation(
                    latitude = packet.latitude,
                    longitude = packet.longitude,
                    accuracy = 15.0f // Estimated proximity accuracy
                )
            }
        }
    }

    /**
     * Terminates BLE scanning.
     */
    @SuppressLint("MissingPermission")
    fun stopScanning() {
        if (isCurrentlyScanning && scanner != null && currentCallback != null) {
            try {
                if (hasRequiredPermissions()) {
                    scanner?.stopScan(currentCallback)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error stopping BLE scanner", e)
            }
        }
        isCurrentlyScanning = false
        currentCallback = null
    }

    fun isScanning(): Boolean = isCurrentlyScanning
}
