package com.findmydevice.security.data.repository

import android.content.Context
import com.findmydevice.security.data.AppDatabase
import com.findmydevice.security.data.entity.LocationEntity
import com.findmydevice.security.data.network.ApiService
import com.findmydevice.security.data.network.BatchLocationRequest
import com.findmydevice.security.data.network.SingleLocationRequest
import com.findmydevice.security.util.NetworkUtils
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

class LocationRepository(
    private val context: Context,
    private val apiService: ApiService
) {
    private val database = AppDatabase.getInstance(context)
    private val locationDao = database.locationDao()

    private val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }

    suspend fun recordLocation(
        lat: Double,
        lng: Double,
        accuracy: Float,
        batteryPct: Float?,
        provider: String = "gps"
    ) = withContext(Dispatchers.IO) {
        val isNetworkAvailable = NetworkUtils.isNetworkAvailable(context)
        val entity = LocationEntity(
            latitude = lat,
            longitude = lng,
            accuracy = accuracy,
            batteryLevel = batteryPct,
            provider = provider,
            isOfflineRecord = !isNetworkAvailable,
            clientTimestamp = System.currentTimeMillis(),
            syncStatus = "PENDING"
        )
        locationDao.insert(entity)

        if (isNetworkAvailable) {
            syncPendingLocations()
        }
    }

    suspend fun syncPendingLocations() = withContext(Dispatchers.IO) {
        val prefs = context.getSharedPreferences("aurafind_prefs", Context.MODE_PRIVATE)
        val deviceId = prefs.getString("device_id", null) ?: return@withContext
        val deviceToken = prefs.getString("device_token", null) ?: return@withContext

        if (!NetworkUtils.isNetworkAvailable(context)) return@withContext

        val pending = locationDao.getPendingLocations(batchSize = 50)
        if (pending.isEmpty()) return@withContext

        val pendingIds = pending.map { it.id }
        locationDao.updateSyncStatus(pendingIds, "UPLOADING")

        try {
            val dtoList = pending.map { item ->
                SingleLocationRequest(
                    latitude = item.latitude,
                    longitude = item.longitude,
                    accuracy = item.accuracy,
                    altitude = item.altitude,
                    speed = item.speed,
                    bearing = item.bearing,
                    provider = item.provider,
                    battery_level = item.batteryLevel,
                    is_offline_record = item.isOfflineRecord,
                    client_timestamp = isoFormat.format(Date(item.clientTimestamp))
                )
            }

            val response = apiService.batchUploadLocations(
                deviceId = deviceId,
                deviceToken = deviceToken,
                request = BatchLocationRequest(locations = dtoList)
            )

            if (response.isSuccessful) {
                locationDao.updateSyncStatus(pendingIds, "SYNCED")
                locationDao.deleteSyncedLocations()
            } else {
                locationDao.updateSyncStatus(pendingIds, "FAILED")
            }
        } catch (e: Exception) {
            e.printStackTrace()
            locationDao.updateSyncStatus(pendingIds, "FAILED")
        }
    }

    suspend fun getPendingCount(): Int = withContext(Dispatchers.IO) {
        locationDao.getPendingCount()
    }
}
