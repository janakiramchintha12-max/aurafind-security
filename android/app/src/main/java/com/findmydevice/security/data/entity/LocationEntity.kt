package com.findmydevice.security.data.entity

import androidx.room.Entity
import androidx.room.PrimaryKey
import java.util.UUID

@Entity(tableName = "pending_locations")
data class LocationEntity(
    @PrimaryKey
    val id: String = UUID.randomUUID().toString(),
    val latitude: Double,
    val longitude: Double,
    val accuracy: Float = 0f,
    val altitude: Double? = null,
    val speed: Float? = null,
    val bearing: Float? = null,
    val provider: String = "gps",
    val batteryLevel: Float? = null,
    val isOfflineRecord: Boolean = false,
    val clientTimestamp: Long = System.currentTimeMillis(),
    var syncStatus: String = "PENDING" // PENDING, UPLOADING, SYNCED, FAILED
)
