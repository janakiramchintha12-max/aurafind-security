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
    val is_tracking_enabled: Boolean? = null,
    val camera_privacy_state: String? = null,
    val microphone_privacy_state: String? = null,
    val location_privacy_state: String? = null,
    val speaker_privacy_state: String? = null,
    val remote_controls_state: String? = null
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

data class AutoPairRequest(
    val username: String,
    val password: String,
    val device_name: String,
    val device_model: String,
    val android_version: String = "14.0",
    val app_version: String = "1.0.0"
)

data class AutoPairResponse(
    val status: String,
    val device_id: String,
    val device_token: String,
    val device_name: String,
    val device_model: String? = null
)

interface ApiService {

    @POST("api/v1/devices/auto-pair")
    suspend fun autoPair(@Body request: AutoPairRequest): Response<AutoPairResponse>

    @POST("api/v1/devices/{device_id}/status")
    suspend fun updateDeviceStatus(
        @Path("device_id") deviceId: String,
        @Header("X-Device-Token") deviceToken: String,
        @Body request: StatusUpdateRequest
    ): Response<Unit>

    @POST("api/v1/devices/{device_id}/privacy-state")
    suspend fun updatePrivacyState(
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

    @POST("api/v1/devices/{device_id}/audio/chunk")
    suspend fun pushAudioChunk(
        @Path("device_id") deviceId: String,
        @Header("X-Device-Token") deviceToken: String,
        @Body request: Map<String, String>
    ): Response<Unit>

    @GET("api/v1/devices/{device_id}/audio/incoming")
    suspend fun pollIncomingAudio(
        @Path("device_id") deviceId: String,
        @Header("X-Device-Token") deviceToken: String
    ): Response<List<String>>

    @POST("api/v1/devices/{device_id}/audio/recordings")
    suspend fun uploadAudioRecording(
        @Path("device_id") deviceId: String,
        @Header("X-Device-Token") deviceToken: String,
        @Body request: AudioRecordingUploadRequest
    ): Response<Unit>

    @POST("api/v1/devices/{device_id}/video/recordings")
    suspend fun uploadVideoRecording(
        @Path("device_id") deviceId: String,
        @Header("X-Device-Token") deviceToken: String,
        @Body request: VideoRecordingUploadRequest
    ): Response<Unit>
}

data class AudioRecordingUploadRequest(
    val audio_data: String,
    val mime_type: String = "audio/mp4",
    val duration_seconds: Float = 10.0f
)

data class VideoRecordingUploadRequest(
    val video_data: String,
    val thumbnail_data: String? = null,
    val mime_type: String = "video/mp4",
    val duration_seconds: Float = 10.0f,
    val facing: String = "FRONT",
    val file_size_bytes: Long = 0L
)

data class CameraFrameRequest(
    val image_data: String,
    val facing: String = "FRONT",
    val fps: Float = 5.0f,
    val timestamp: String? = null
)
