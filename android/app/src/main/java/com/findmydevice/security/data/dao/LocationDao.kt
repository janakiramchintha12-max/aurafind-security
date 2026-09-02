package com.findmydevice.security.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.findmydevice.security.data.entity.LocationEntity

@Dao
interface LocationDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(location: LocationEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(locations: List<LocationEntity>)

    @Query("SELECT * FROM pending_locations WHERE syncStatus IN ('PENDING', 'FAILED') ORDER BY clientTimestamp ASC LIMIT :batchSize")
    suspend fun getPendingLocations(batchSize: Int = 50): List<LocationEntity>

    @Query("UPDATE pending_locations SET syncStatus = :status WHERE id IN (:ids)")
    suspend fun updateSyncStatus(ids: List<String>, status: String)

    @Query("DELETE FROM pending_locations WHERE syncStatus = 'SYNCED'")
    suspend fun deleteSyncedLocations()

    @Query("SELECT COUNT(*) FROM pending_locations WHERE syncStatus IN ('PENDING', 'FAILED')")
    suspend fun getPendingCount(): Int
}
