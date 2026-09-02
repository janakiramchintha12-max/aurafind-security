package com.findmydevice.security.data.network

import retrofit2.Response
import retrofit2.http.*

data class StatusUpdateRequest(
    val battery_pct: Float? = null,
    val is_charging: Boolean? = null,
    val network_type: String? = null,
    val wifi_status: Boolean? = null,
    val sim_status: Boolean? = null,
    val sim_number: String? = null,
    val gps_status: Boolean? = null,
    val tracking_mode: String? = null,
    val is_tracking_enabled: Boolean? = null
)

data class CommandResultRequest(
    val status: String,
    val result: String? = null
)

data class SnapshotCreateRequest(
    val image_data: String,
    val latitude: Double? = null,
    val longitude: Double? = null,
    val is_intruder_alert: Boolean = false
)

data class SingleLocationRequest(
    val latitude: Double,
    val longitude: Double,
    val accuracy: Float? = 0f,
    val altitude: Double? = null,
    val speed: Float? = null,
    val bearing: Float? = null,
    val provider: String = "gps",
    val battery_level: Float? = null,
    val is_offline_record: Boolean = false,
    val is_battery_beacon: Boolean = false,
    val client_timestamp: String
)

data class BatchLocationRequest(
    val locations: List<SingleLocationRequest>
)

data class RemoteCommandDto(
    val id: String,
    val command_type: String,
    val payload: String?,
    val created_at: String
)

interface ApiService {

    @POST("api/v1/devices/{device_id}/status")
    suspend fun updateDeviceStatus(
        @Path("device_id") deviceId: String,
        @Header("X-Device-Token") deviceToken: String,
        @Body request: StatusUpdateRequest
    ): Response<Unit>

    @GET("api/v1/devices/{device_id}/commands/pending")
    suspend fun getPendingCommands(
        @Path("device_id") deviceId: String,
        @Header("X-Device-Token") deviceToken: String
    ): Response<List<RemoteCommandDto>>

    @PATCH("api/v1/devices/{device_id}/commands/{command_id}/result")
    suspend fun submitCommandResult(
        @Path("device_id") deviceId: String,
        @Path("command_id") commandId: String,
        @Header("X-Device-Token") deviceToken: String,
        @Body request: CommandResultRequest
    ): Response<Unit>

    @POST("api/v1/devices/{device_id}/snapshots")
    suspend fun createSnapshot(
        @Path("device_id") deviceId: String,
        @Header("X-Device-Token") deviceToken: String,
        @Body request: SnapshotCreateRequest
    ): Response<Unit>

    @POST("api/v1/devices/{device_id}/locations/single")
    suspend fun postLocation(
        @Path("device_id") deviceId: String,
        @Header("X-Device-Token") deviceToken: String,
        @Body location: SingleLocationRequest
    ): Response<Unit>

    @POST("api/v1/devices/{device_id}/locations/batch")
    suspend fun batchUploadLocations(
        @Path("device_id") deviceId: String,
        @Header("X-Device-Token") deviceToken: String,
        @Body request: BatchLocationRequest
    ): Response<Unit>

    @POST("api/v1/devices/{device_id}/camera/frame")
    suspend fun pushCameraFrame(
        @Path("device_id") deviceId: String,
        @Header("X-Device-Token") deviceToken: String,
        @Body request: CameraFrameRequest
    ): Response<Unit>
}

data class CameraFrameRequest(
    val image_data: String,
    val facing: String = "FRONT",
    val fps: Float = 5.0f,
    val timestamp: String? = null
)
