package com.findmydevice.security.service

import android.content.Context
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

    override suspend fun doWork(): Result {
        return try {
            val retrofit = Retrofit.Builder()
                .baseUrl("http://192.168.31.39:8000/")
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
