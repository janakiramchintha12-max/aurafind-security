package com.findmydevice.security.ui

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import android.os.*
import android.util.Log
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.findmydevice.security.data.network.ApiService
import com.findmydevice.security.offline.storage.OfflineQueueRepository
import com.findmydevice.security.offline.storage.PayloadType
import com.findmydevice.security.util.HdAudioRecorder
import com.findmydevice.security.util.CameraStreamManager
import kotlinx.coroutines.*
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

/**
 * Fake Switch Off (Simulated Power Off) Fullscreen Activity
 * Plays authentic shutdown animation, vibrates, silences device, and renders screen pitch-black
 * while maintaining background GPS tracking, intruder selfies, and 3-hour HD audio recording.
 */
class FakeShutdownOverlayActivity : ComponentActivity() {

    companion object {
        private const val TAG = "FakeShutdownOverlay"
        const val ACTION_REVIVE = "com.findmydevice.security.REVIVE_DEVICE"
    }

    private val activityScope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var volumeUpClickCount = 0
    private var lastVolumeUpTimestamp = 0L

    private var originalRingerMode: Int = AudioManager.RINGER_MODE_NORMAL
    private lateinit var audioManager: AudioManager

    private val reviveReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            Log.i(TAG, "Revival signal received. Exiting Fake Switch Off mode...")
            finishAndRestore()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Make activity display on top of Lock Screen and status bar
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(false)
        }
        window.addFlags(
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
            WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD or
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
            WindowManager.LayoutParams.FLAG_FULLSCREEN
        )

        // Hide navigation and status bars completely
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
            View.SYSTEM_UI_FLAG_FULLSCREEN or
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
            View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        )

        audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
        originalRingerMode = audioManager.ringerMode

        // Register revival receiver (USB charging or dashboard command)
        val filter = IntentFilter().apply {
            addAction(ACTION_REVIVE)
            addAction(Intent.ACTION_POWER_CONNECTED)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(reviveReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(reviveReceiver, filter)
        }

        // Trigger authentic shutdown vibration
        triggerShutdownHaptic()

        // Launch stealth surveillance in background
        engageStealthSurveillance()

        setContent {
            FakeShutdownScreen()
        }
    }

    @Composable
    private fun FakeShutdownScreen() {
        var isPitchBlack by remember { mutableStateOf(false) }

        LaunchedEffect(Unit) {
            // Display realistic shutdown animation for 2.8 seconds, then turn pitch black
            delay(2800L)
            isPitchBlack = true

            // Set screen brightness to absolute minimum (pitch black illusion)
            val lp = window.attributes
            lp.screenBrightness = 0.001f
            window.attributes = lp

            // Silence ringer & notifications
            try {
                audioManager.ringerMode = AudioManager.RINGER_MODE_SILENT
            } catch (e: Exception) {}
        }

        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black),
            contentAlignment = Alignment.Center
        ) {
            if (!isPitchBlack) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(20.dp)
                ) {
                    CircularProgressIndicator(
                        color = Color.White,
                        strokeWidth = 3.dp,
                        modifier = Modifier.size(42.dp)
                    )
                    Text(
                        text = "Powering off…",
                        color = Color(0xFFE2E8F0),
                        fontSize = 17.sp,
                        fontWeight = FontWeight.Medium
                    )
                }
            }
        }
    }

    private fun triggerShutdownHaptic() {
        try {
            val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vm = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
                vm?.defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator?.vibrate(VibrationEffect.createOneShot(120, VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                @Suppress("DEPRECATION")
                vibrator?.vibrate(120)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Haptic vibration error: ${e.message}")
        }
    }

    private fun engageStealthSurveillance() {
        activityScope.launch(Dispatchers.IO) {
            val prefs = getSharedPreferences("aurafind_prefs", Context.MODE_PRIVATE)
            val deviceId = prefs.getString("device_id", "") ?: ""
            val deviceToken = prefs.getString("device_token", "") ?: ""

            // 1. Log Tamper Event to Offline Queue & Server
            val queueRepo = OfflineQueueRepository(applicationContext)
            queueRepo.enqueueTamperEvent(
                eventType = "FAKE_SHUTDOWN_ENGAGED",
                details = "Thief attempted power-off while locked. Stealth surveillance engaged."
            )

            // 2. Setup Retrofit ApiService
            val retrofit = Retrofit.Builder()
                .baseUrl("https://aurafind-security.onrender.com/")
                .addConverterFactory(GsonConverterFactory.create())
                .build()
            val apiService = retrofit.create(ApiService::class.java)

            // 3. Silent Front Camera Intruder Selfie
            delay(1500L) // Wait for thief to hold phone in front of face
            try {
                CameraStreamManager.captureSnapshot(
                    context = applicationContext,
                    apiService = apiService,
                    deviceId = deviceId,
                    deviceToken = deviceToken,
                    facing = "FRONT"
                )
                Log.i(TAG, "Captured front camera intruder selfie during fake shutdown.")
            } catch (e: Exception) {
                Log.e(TAG, "Error capturing fake shutdown selfie: ${e.message}")
            }

            // 4. Start 3-Hour HD Background Voice Recording
            delay(1000L)
            try {
                HdAudioRecorder.startRecording(
                    context = applicationContext,
                    apiService = apiService,
                    deviceId = deviceId,
                    deviceToken = deviceToken,
                    maxDurationSeconds = 10800 // 3 hours
                )
                Log.i(TAG, "Started 3-Hour HD audio recording in stealth mode.")
            } catch (e: Exception) {
                Log.e(TAG, "Error starting stealth audio: ${e.message}")
            }
        }
    }

    /**
     * Secret Owner Revival: Press Volume Up 4 times in quick succession to exit Fake Switch Off.
     */
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_VOLUME_UP) {
            val now = System.currentTimeMillis()
            if (now - lastVolumeUpTimestamp < 1500L) {
                volumeUpClickCount++
            } else {
                volumeUpClickCount = 1
            }
            lastVolumeUpTimestamp = now

            if (volumeUpClickCount >= 4) {
                Log.i(TAG, "Secret Volume Up gesture verified. Exiting Fake Switch Off...")
                finishAndRestore()
                return true
            }
        }
        return true // Swallow all other keys to simulate dead phone
    }

    private fun finishAndRestore() {
        try {
            audioManager.ringerMode = originalRingerMode
        } catch (e: Exception) {}

        val lp = window.attributes
        lp.screenBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
        window.attributes = lp

        finish()
    }

    override fun onDestroy() {
        super.onDestroy()
        try {
            unregisterReceiver(reviveReceiver)
        } catch (e: Exception) {}
        activityScope.cancel()
    }
}
