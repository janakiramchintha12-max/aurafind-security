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
