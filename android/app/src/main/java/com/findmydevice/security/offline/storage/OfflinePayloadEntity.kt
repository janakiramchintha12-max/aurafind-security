package com.findmydevice.security.offline.storage

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

enum class PayloadType {
    LOCATION_UPDATE,
    AUDIO_RECORDING_FILE,
    CAMERA_SNAPSHOT_FILE,
    TAMPER_EVENT
}

@Entity(tableName = "offline_payloads")
data class OfflinePayloadEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "payload_type") val payloadType: String,
    @ColumnInfo(name = "payload_data") val payloadData: String,
    @ColumnInfo(name = "file_path") val filePath: String? = null,
    @ColumnInfo(name = "timestamp") val timestamp: Long = System.currentTimeMillis(),
    @ColumnInfo(name = "retry_count") val retryCount: Int = 0
)
