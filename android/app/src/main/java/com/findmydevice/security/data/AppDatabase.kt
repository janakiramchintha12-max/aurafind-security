package com.findmydevice.security.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import com.findmydevice.security.data.dao.CommandDao
import com.findmydevice.security.data.dao.LocationDao
import com.findmydevice.security.data.entity.CommandEntity
import com.findmydevice.security.data.entity.LocationEntity
import com.findmydevice.security.offline.storage.OfflinePayloadDao
import com.findmydevice.security.offline.storage.OfflinePayloadEntity

@Database(
    entities = [LocationEntity::class, CommandEntity::class, OfflinePayloadEntity::class],
    version = 2,
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {

    abstract fun locationDao(): LocationDao
    abstract fun commandDao(): CommandDao
    abstract fun offlinePayloadDao(): OfflinePayloadDao

    companion object {
        @Volatile
        private var INSTANCE: AppDatabase? = null

        fun getInstance(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "aurafind_db"
                ).fallbackToDestructiveMigration().build()
                INSTANCE = instance
                instance
            }
        }
    }
}
