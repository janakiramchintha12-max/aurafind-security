package com.findmydevice.security.ui

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import com.findmydevice.security.util.ScreenMirrorManager

/**
 * Transparent helper activity to prompt the user once for MediaProjection screen capture permission
 * and store the grant token for ongoing Parental Screen Mirroring.
 */
class ScreenCapturePermissionActivity : ComponentActivity() {

    companion object {
        private const val TAG = "ScreenCapturePerm"
    }

    private val captureLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == Activity.RESULT_OK && result.data != null) {
            Log.i(TAG, "User granted MediaProjection screen capture permission.")
            ScreenMirrorManager.setMediaProjectionResult(result.resultCode, result.data!!)
            com.findmydevice.security.util.RealtimeMediaStreamer.setProjectionIntent(result.resultCode, result.data!!)

            try {
                val serviceIntent = Intent(applicationContext, com.findmydevice.security.service.LocationService::class.java).apply {
                    putExtra("COMMAND_TYPE", "START_SCREEN_MIRROR")
                }
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                    startForegroundService(serviceIntent)
                } else {
                    startService(serviceIntent)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error starting location service after perm grant: ${e.message}")
            }
        } else {
            Log.w(TAG, "User denied MediaProjection screen capture permission.")
        }
        finish()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val mgr = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as? MediaProjectionManager
        if (mgr != null) {
            captureLauncher.launch(mgr.createScreenCaptureIntent())
        } else {
            finish()
        }
    }
}
