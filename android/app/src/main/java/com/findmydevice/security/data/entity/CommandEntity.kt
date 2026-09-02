package com.findmydevice.security.data.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "pending_commands")
data class CommandEntity(
    @PrimaryKey
    val id: String,
    val commandType: String,
    val payload: String = "{}",
    var status: String = "PENDING", // PENDING, EXECUTED, FAILED
    val createdAt: Long = System.currentTimeMillis()
)
