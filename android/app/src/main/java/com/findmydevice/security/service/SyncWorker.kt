package com.findmydevice.security.service

import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.content.ContextCompat
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.findmydevice.security.data.network.ApiService
import com.findmydevice.security.data.repository.LocationRepository
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

class SyncWorker(
    appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {

    private val CLOUD_BASE_URL = "https://aurafind-security.onrender.com/"

    override suspend fun doWork(): Result {
        return try {
            // 1. Watchdog: ensure LocationService is always alive
            try {
                val serviceIntent = Intent(applicationContext, LocationService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    ContextCompat.startForegroundService(applicationContext, serviceIntent)
                } else {
                    applicationContext.startService(serviceIntent)
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }

            // 2. Sync any pending offline records to cloud
            val retrofit = Retrofit.Builder()
                .baseUrl(CLOUD_BASE_URL)
                .addConverterFactory(GsonConverterFactory.create())
                .build()
            val apiService = retrofit.create(ApiService::class.java)
            val repository = LocationRepository(applicationContext, apiService)

            repository.syncPendingLocations()
            Result.success()
        } catch (e: Exception) {
            e.printStackTrace()
            Result.retry()
        }
    }
}
