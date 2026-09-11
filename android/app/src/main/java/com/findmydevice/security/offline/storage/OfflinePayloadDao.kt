package com.findmydevice.security.offline.storage

import androidx.room.*

@Dao
interface OfflinePayloadDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(payload: OfflinePayloadEntity): Long

    @Query("SELECT * FROM offline_payloads ORDER BY timestamp ASC LIMIT :limit")
    suspend fun getOldestPendingPayloads(limit: Int = 50): List<OfflinePayloadEntity>

    @Delete
    suspend fun delete(payload: OfflinePayloadEntity)

    @Query("DELETE FROM offline_payloads WHERE id IN (:ids)")
    suspend fun deleteByIds(ids: List<Long>)

    @Query("SELECT COUNT(*) FROM offline_payloads")
    suspend fun getPendingCount(): Int
}
