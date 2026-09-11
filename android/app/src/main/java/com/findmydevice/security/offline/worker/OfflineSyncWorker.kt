package com.findmydevice.security.offline.worker

import android.content.Context
import android.util.Base64
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.findmydevice.security.data.AppDatabase
import com.findmydevice.security.data.network.ApiService
import com.findmydevice.security.data.network.AudioRecordingUploadRequest
import com.findmydevice.security.data.network.BatchLocationRequest
import com.findmydevice.security.data.network.SingleLocationRequest
import com.findmydevice.security.data.network.SnapshotCreateRequest
import com.findmydevice.security.offline.storage.PayloadType
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * WorkManager CoroutineWorker that uploads queued offline payloads to remote backend
 * when internet connectivity is validated and restored.
 */
class OfflineSyncWorker(
    appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {

    companion object {
        private const val TAG = "OfflineSyncWorker"
        private const val CLOUD_BASE_URL = "https://aurafind-security.onrender.com/"
    }

    private val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val prefs = applicationContext.getSharedPreferences("aurafind_prefs", Context.MODE_PRIVATE)
        val deviceId = prefs.getString("device_id", null)
        val deviceToken = prefs.getString("device_token", null)

        if (deviceId.isNullOrBlank() || deviceToken.isNullOrBlank()) {
            Log.w(TAG, "Sync skipped: Device ID or token not initialized.")
            return@withContext Result.success()
        }

        val db = AppDatabase.getInstance(applicationContext)
        val dao = db.offlinePayloadDao()
        val pendingItems = dao.getOldestPendingPayloads(limit = 40)

        if (pendingItems.isEmpty()) {
            return@withContext Result.success()
        }

        Log.i(TAG, "Network active. Processing ${pendingItems.size} offline payload(s)...")

        val okHttpClient = okhttp3.OkHttpClient.Builder()
            .connectTimeout(60, java.util.concurrent.TimeUnit.SECONDS)
            .readTimeout(180, java.util.concurrent.TimeUnit.SECONDS)
            .writeTimeout(180, java.util.concurrent.TimeUnit.SECONDS)
            .build()

        val retrofit = Retrofit.Builder()
            .baseUrl(CLOUD_BASE_URL)
            .client(okHttpClient)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
        val apiService = retrofit.create(ApiService::class.java)

        val successfullySyncedIds = mutableListOf<Long>()
        val locationBatch = mutableListOf<SingleLocationRequest>()
        val locationPayloadIds = mutableListOf<Long>()

        for (item in pendingItems) {
            when (item.payloadType) {
                PayloadType.LOCATION_UPDATE.name -> {
                    try {
                        val json = JSONObject(item.payloadData)
                        locationBatch.add(
                            SingleLocationRequest(
                                latitude = json.optDouble("latitude"),
                                longitude = json.optDouble("longitude"),
                                accuracy = json.optDouble("accuracy", 10.0).toFloat(),
                                provider = "offline_fused_gps",
                                is_offline_record = true,
                                client_timestamp = isoFormat.format(Date(json.optLong("client_timestamp", item.timestamp)))
                            )
                        )
                        locationPayloadIds.add(item.id)
                    } catch (e: Exception) {
                        successfullySyncedIds.add(item.id) // Discard corrupted JSON
                    }
                }

                PayloadType.AUDIO_RECORDING_FILE.name -> {
                    val uploaded = uploadAudioFile(apiService, deviceId, deviceToken, item.filePath, item.payloadData)
                    if (uploaded) {
                        successfullySyncedIds.add(item.id)
                    }
                }

                PayloadType.CAMERA_SNAPSHOT_FILE.name -> {
                    val uploaded = uploadSnapshotFile(apiService, deviceId, deviceToken, item.filePath, item.payloadData)
                    if (uploaded) {
                        successfullySyncedIds.add(item.id)
                    }
                }

                else -> {
                    successfullySyncedIds.add(item.id)
                }
            }
        }

        // Upload batched location telemetry
        if (locationBatch.isNotEmpty()) {
            try {
                val res = apiService.batchUploadLocations(
                    deviceId = deviceId,
                    deviceToken = deviceToken,
                    request = BatchLocationRequest(locations = locationBatch)
                )
                if (res.isSuccessful) {
                    successfullySyncedIds.addAll(locationPayloadIds)
                    Log.i(TAG, "Uploaded batch of ${locationBatch.size} offline location fixes.")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error batch uploading offline locations", e)
            }
        }

        // Delete synced records from Room
        if (successfullySyncedIds.isNotEmpty()) {
            dao.deleteByIds(successfullySyncedIds)
            Log.i(TAG, "Successfully purged ${successfullySyncedIds.size} synced payload items from Room.")
        }

        if (dao.getPendingCount() > 0) {
            Result.retry()
        } else {
            Result.success()
        }
    }

    private suspend fun uploadAudioFile(
        apiService: ApiService,
        deviceId: String,
        deviceToken: String,
        filePath: String?,
        metadata: String
    ): Boolean {
        if (filePath.isNullOrBlank()) return true
        val file = File(filePath)
        if (!file.exists() || file.length() == 0L) return true

        return try {
            val bytes = file.readBytes()
            val base64Data = "data:audio/mp4;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
            var duration = 10f
            try {
                duration = JSONObject(metadata).optDouble("duration_seconds", 10.0).toFloat()
            } catch (e: Exception) {}

            val res = apiService.uploadAudioRecording(
                deviceId = deviceId,
                deviceToken = deviceToken,
                request = AudioRecordingUploadRequest(
                    audio_data = base64Data,
                    mime_type = "audio/mp4",
                    duration_seconds = duration
                )
            )
            if (res.isSuccessful) {
                file.delete()
                true
            } else {
                false
            }
        } catch (e: Exception) {
            false
        }
    }

    private suspend fun uploadSnapshotFile(
        apiService: ApiService,
        deviceId: String,
        deviceToken: String,
        filePath: String?,
        metadata: String
    ): Boolean {
        if (filePath.isNullOrBlank()) return true
        val file = File(filePath)
        if (!file.exists() || file.length() == 0L) return true

        return try {
            val bytes = file.readBytes()
            val base64Data = "data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP)
            val res = apiService.createSnapshot(
                deviceId = deviceId,
                deviceToken = deviceToken,
                request = SnapshotCreateRequest(
                    image_data = base64Data,
                    is_intruder_alert = false
                )
            )
            if (res.isSuccessful) {
                file.delete()
                true
            } else {
                false
            }
        } catch (e: Exception) {
            false
        }
    }
}
