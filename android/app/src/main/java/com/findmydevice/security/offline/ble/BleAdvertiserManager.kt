package com.findmydevice.security.offline.ble

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.BluetoothLeAdvertiser
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.ParcelUuid
import android.util.Log
import androidx.core.content.ContextCompat

/**
 * Module 3: BLE Offline Location Beacon Transmitter
 * Broadcasts compact AES-128 encrypted coordinate payloads via Bluetooth Low Energy
 * when the device is completely offline.
 */
class BleAdvertiserManager(private val context: Context) {

    companion object {
        private const val TAG = "BleAdvertiserManager"
        val SERVICE_UUID: ParcelUuid = ParcelUuid.fromString("0000A1B2-0000-1000-8000-00805F9B34FB")
    }

    private val bluetoothManager: BluetoothManager? =
        context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    private val bluetoothAdapter: BluetoothAdapter? = bluetoothManager?.adapter
    private var advertiser: BluetoothLeAdvertiser? = null

    private var isCurrentlyAdvertising = false
    private var currentCallback: AdvertiseCallback? = null

    /**
     * Checks if Bluetooth and necessary permissions are present.
     */
    fun isBleAdvertisingSupported(): Boolean {
        if (bluetoothAdapter == null || !bluetoothAdapter.isEnabled) {
            Log.w(TAG, "Bluetooth is disabled or unsupported on this device.")
            return false
        }
        if (!context.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)) {
            Log.w(TAG, "Bluetooth LE hardware feature not found.")
            return false
        }
        return bluetoothAdapter.isMultipleAdvertisementSupported || bluetoothAdapter.bluetoothLeAdvertiser != null
    }

    private fun hasRequiredPermissions(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_ADVERTISE) == PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
        } else {
            ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH) == PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_ADMIN) == PackageManager.PERMISSION_GRANTED
        }
    }

    /**
     * Encrypts and transmits latest GPS coordinates as a BLE service data beacon.
     */
    @SuppressLint("MissingPermission")
    fun startAdvertising(latitude: Double, longitude: Double, deviceId: String) {
        if (!hasRequiredPermissions()) {
            Log.w(TAG, "Missing BLUETOOTH_ADVERTISE permissions.")
            return
        }

        if (!isBleAdvertisingSupported()) {
            Log.w(TAG, "BLE advertising is not supported or Bluetooth is disabled.")
            return
        }

        stopAdvertising()

        advertiser = bluetoothAdapter?.bluetoothLeAdvertiser
        if (advertiser == null) {
            Log.e(TAG, "BluetoothLeAdvertiser instance is null.")
            return
        }

        val packet = BleCryptoUtils.BleLocationPacket(
            latitude = latitude,
            longitude = longitude,
            timestampSeconds = System.currentTimeMillis() / 1000L,
            deviceIdHash = deviceId.hashCode()
        )

        val encryptedPayload = BleCryptoUtils.encrypt(packet)

        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_POWER)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM)
            .setConnectable(false)
            .setTimeout(0)
            .build()

        val data = AdvertiseData.Builder()
            .addServiceUuid(SERVICE_UUID)
            .addServiceData(SERVICE_UUID, encryptedPayload)
            .setIncludeDeviceName(false)
            .setIncludeTxPowerLevel(false)
            .build()

        val callback = object : AdvertiseCallback() {
            override fun onStartSuccess(settingsInEffect: AdvertiseSettings?) {
                super.onStartSuccess(settingsInEffect)
                isCurrentlyAdvertising = true
                Log.i(TAG, "BLE Offline Beacon broadcast active (Lat: $latitude, Lon: $longitude)")
            }

            override fun onStartFailure(errorCode: Int) {
                super.onStartFailure(errorCode)
                isCurrentlyAdvertising = false
                Log.e(TAG, "BLE Offline Beacon broadcast failed with code: $errorCode")
            }
        }

        currentCallback = callback
        try {
            advertiser?.startAdvertising(settings, data, callback)
        } catch (e: Exception) {
            Log.e(TAG, "Exception starting BLE advertisement", e)
        }
    }

    /**
     * Updates the advertised coordinates if already active.
     */
    fun updateCoordinates(latitude: Double, longitude: Double, deviceId: String) {
        if (isCurrentlyAdvertising) {
            startAdvertising(latitude, longitude, deviceId)
        }
    }

    /**
     * Halts BLE advertising beacon.
     */
    @SuppressLint("MissingPermission")
    fun stopAdvertising() {
        if (isCurrentlyAdvertising && advertiser != null && currentCallback != null) {
            try {
                if (hasRequiredPermissions()) {
                    advertiser?.stopAdvertising(currentCallback)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error stopping BLE advertiser", e)
            }
        }
        isCurrentlyAdvertising = false
        currentCallback = null
    }

    fun isAdvertising(): Boolean = isCurrentlyAdvertising
}
