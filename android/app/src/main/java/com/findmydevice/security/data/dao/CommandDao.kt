package com.findmydevice.security.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.findmydevice.security.data.entity.CommandEntity

@Dao
interface CommandDao {

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(command: CommandEntity)

    @Query("SELECT * FROM pending_commands WHERE status = 'PENDING'")
    suspend fun getPendingCommands(): List<CommandEntity>

    @Query("UPDATE pending_commands SET status = :status WHERE id = :id")
    suspend fun updateStatus(id: String, status: String)
}
