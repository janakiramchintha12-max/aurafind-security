package com.findmydevice.security.offline.storage

import android.content.Context
import androidx.work.*
import com.findmydevice.security.data.AppDatabase
import com.findmydevice.security.offline.worker.OfflineSyncWorker
import java.util.concurrent.TimeUnit

/**
 * Module 2: Store-and-Forward Local Queue Repository
 * Persists location traces, media recording paths, and tamper logs in SQLite/Room
 * and triggers WorkManager tasks constrained to CONNECTED network status.
 */
class OfflineQueueRepository(private val context: Context) {

    private val db = AppDatabase.getInstance(context)
    private val dao = db.offlinePayloadDao()

    suspend fun enqueueLocation(latitude: Double, longitude: Double, accuracy: Float) {
        val json = """{"latitude":$latitude,"longitude":$longitude,"accuracy":$accuracy,"client_timestamp":${System.currentTimeMillis()}}"""
        dao.insert(
            OfflinePayloadEntity(
                payloadType = PayloadType.LOCATION_UPDATE.name,
                payloadData = json
            )
        )
        scheduleSyncJob()
    }

    suspend fun enqueueMediaFile(filePath: String, type: PayloadType, metadataJson: String = "{}") {
        dao.insert(
            OfflinePayloadEntity(
                payloadType = type.name,
                payloadData = metadataJson,
                filePath = filePath
            )
        )
        scheduleSyncJob()
    }

    suspend fun enqueueTamperEvent(eventType: String, details: String) {
        val json = """{"event_type":"$eventType","details":"$details","timestamp":${System.currentTimeMillis()}}"""
        dao.insert(
            OfflinePayloadEntity(
                payloadType = PayloadType.TAMPER_EVENT.name,
                payloadData = json
            )
        )
        scheduleSyncJob()
    }

    /**
     * Enqueues an expedited WorkManager task that executes automatically when network connectivity is restored.
     */
    fun scheduleSyncJob() {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        val syncRequest = OneTimeWorkRequestBuilder<OfflineSyncWorker>()
            .setConstraints(constraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
            .addTag("OFFLINE_PAYLOAD_SYNC_TAG")
            .build()

        WorkManager.getInstance(context).enqueueUniqueWork(
            "OFFLINE_PAYLOAD_SYNC_WORK",
            ExistingWorkPolicy.KEEP,
            syncRequest
        )
    }
}
