package com.findmydevice.security.ui

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.view.KeyEvent
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.findmydevice.security.util.NetworkUtils

class LostModeOverlayActivity : ComponentActivity() {

    companion object {
        const val ACTION_DISMISS_LOST_MODE = "com.findmydevice.security.ACTION_DISMISS_LOST_MODE"
    }

    private var activityWakeLock: PowerManager.WakeLock? = null
    private var isDialerLaunched = false
    private val mainHandler = Handler(Looper.getMainLooper())

    private val lostModeReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                ACTION_DISMISS_LOST_MODE -> {
                    releaseActivityWakeLock()
                    finish()
                }
                Intent.ACTION_SCREEN_OFF -> {
                    val prefs = getSharedPreferences("aurafind_prefs", Context.MODE_PRIVATE)
                    if (prefs.getBoolean("is_lost_mode", false)) {
                        acquireActivityWakeLock()
                        relaunchSelf()
                    }
                }
                Intent.ACTION_SCREEN_ON, Intent.ACTION_USER_PRESENT -> {
                    val prefs = getSharedPreferences("aurafind_prefs", Context.MODE_PRIVATE)
                    if (prefs.getBoolean("is_lost_mode", false)) {
                        enforceImmersive()
                        applyWindowFlags()
                    }
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Ensure activity shows on lock screen and keeps screen turned on indefinitely
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        }
        applyWindowFlags()
        enforceImmersive()
        acquireActivityWakeLock()

        val filter = IntentFilter().apply {
            addAction(ACTION_DISMISS_LOST_MODE)
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_USER_PRESENT)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(lostModeReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(lostModeReceiver, filter)
        }

        val prefs = getSharedPreferences("aurafind_prefs", Context.MODE_PRIVATE)
        val ownerPhone = intent.getStringExtra("EMERGENCY_NUMBER")?.ifBlank { null }
            ?: prefs.getString("lost_mode_phone", null)
            ?: NetworkUtils.getSimPhoneNumber(this).ifBlank { null }
            ?: "+91 94409 50130"

        setContent {
            LostModeKioskScreen(
                ownerPhone = ownerPhone,
                onCallOwner = {
                    isDialerLaunched = true
                    try {
                        val dialIntent = Intent(Intent.ACTION_DIAL, Uri.parse("tel:$ownerPhone")).apply {
                            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        }
                        startActivity(dialIntent)
                    } catch (e: Exception) {
                        e.printStackTrace()
                    }
                }
            )
        }
    }

    private fun applyWindowFlags() {
        @Suppress("DEPRECATION")
        window.addFlags(
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
            WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD or
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
            WindowManager.LayoutParams.FLAG_FULLSCREEN or
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
        )
    }

    private fun acquireActivityWakeLock() {
        try {
            if (activityWakeLock == null || !activityWakeLock!!.isHeld) {
                val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager
                @Suppress("DEPRECATION")
                activityWakeLock = pm?.newWakeLock(
                    PowerManager.SCREEN_BRIGHT_WAKE_LOCK or
                    PowerManager.ACQUIRE_CAUSES_WAKEUP or
                    PowerManager.ON_AFTER_RELEASE,
                    "AuraFind::LostModeActivityScreenLock"
                )?.apply {
                    acquire(24 * 60 * 60 * 1000L) // 24 hours lock
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun releaseActivityWakeLock() {
        try {
            if (activityWakeLock?.isHeld == true) {
                activityWakeLock?.release()
            }
            activityWakeLock = null
        } catch (e: Exception) {}
    }

    /** Full immersive sticky mode: hides status bar and navigation gestures/bar */
    private fun enforceImmersive() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.let { ctrl ->
                ctrl.hide(WindowInsets.Type.systemBars())
                ctrl.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or android.view.View.SYSTEM_UI_FLAG_FULLSCREEN
                or android.view.View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or android.view.View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or android.view.View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            )
        }
    }

    private fun relaunchSelf() {
        val prefs = getSharedPreferences("aurafind_prefs", Context.MODE_PRIVATE)
        if (prefs.getBoolean("is_lost_mode", false)) {
            val relaunch = Intent(applicationContext, LostModeOverlayActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            }
            startActivity(relaunch)
        }
    }

    override fun onResume() {
        super.onResume()
        isDialerLaunched = false
        applyWindowFlags()
        enforceImmersive()
        acquireActivityWakeLock()
    }

    override fun onPause() {
        super.onPause()
        val prefs = getSharedPreferences("aurafind_prefs", Context.MODE_PRIVATE)
        if (prefs.getBoolean("is_lost_mode", false) && !isDialerLaunched) {
            // Re-assert LostModeOverlayActivity immediately if backgrounded without dialer
            mainHandler.postDelayed({
                relaunchSelf()
            }, 100)
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        val prefs = getSharedPreferences("aurafind_prefs", Context.MODE_PRIVATE)
        if (prefs.getBoolean("is_lost_mode", false)) {
            enforceImmersive()
            if (!hasFocus && !isDialerLaunched) {
                // Dismiss any system menus or status bar pulls
                @Suppress("DEPRECATION")
                sendBroadcast(Intent(Intent.ACTION_CLOSE_SYSTEM_DIALOGS))
                mainHandler.postDelayed({
                    relaunchSelf()
                }, 150)
            }
        }
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        val prefs = getSharedPreferences("aurafind_prefs", Context.MODE_PRIVATE)
        if (prefs.getBoolean("is_lost_mode", false) && !isDialerLaunched) {
            relaunchSelf()
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        // Block back navigation completely
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        // Block hardware keys (Home, Recent Apps, Volume, etc.)
        when (keyCode) {
            KeyEvent.KEYCODE_HOME,
            KeyEvent.KEYCODE_APP_SWITCH,
            KeyEvent.KEYCODE_BACK,
            KeyEvent.KEYCODE_VOLUME_UP,
            KeyEvent.KEYCODE_VOLUME_DOWN,
            KeyEvent.KEYCODE_VOLUME_MUTE,
            KeyEvent.KEYCODE_CAMERA,
            KeyEvent.KEYCODE_ASSIST,
            KeyEvent.KEYCODE_VOICE_ASSIST -> return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onDestroy() {
        super.onDestroy()
        releaseActivityWakeLock()
        try {
            unregisterReceiver(lostModeReceiver)
        } catch (e: Exception) {}
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Full-Screen Lost Mode Kiosk Composable UI
// ═══════════════════════════════════════════════════════════════════════════════
@Composable
fun LostModeKioskScreen(
    ownerPhone: String,
    onCallOwner: () -> Unit
) {
    val infiniteTransition = rememberInfiniteTransition(label = "pulse")
    val pulseScale by infiniteTransition.animateFloat(
        initialValue = 1.0f,
        targetValue = 1.12f,
        animationSpec = infiniteRepeatable(
            animation = tween(1200, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "pulseScale"
    )

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    colors = listOf(
                        Color(0xFF030712), // Very deep slate/black
                        Color(0xFF0B1120), // Dark Navy
                        Color(0xFF1E0B12), // Deep crimson edge
                        Color(0xFF030712)
                    )
                )
            ),
        contentAlignment = Alignment.Center
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 24.dp, vertical = 36.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.SpaceBetween
        ) {
            // Top Section: Warning Header & Pulse Beacon
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(16.dp),
                modifier = Modifier.padding(top = 24.dp)
            ) {
                // Pulsing Emergency Beacon
                Box(
                    modifier = Modifier
                        .size(104.dp)
                        .scale(pulseScale)
                        .background(Color(0xFFEF4444).copy(alpha = 0.15f), CircleShape)
                        .border(2.dp, Color(0xFFEF4444).copy(alpha = 0.5f), CircleShape),
                    contentAlignment = Alignment.Center
                ) {
                    Box(
                        modifier = Modifier
                            .size(76.dp)
                            .background(Color(0xFFEF4444).copy(alpha = 0.25f), CircleShape),
                        contentAlignment = Alignment.Center
                    ) {
                        Text("🔒", fontSize = 40.sp)
                    }
                }

                // Title
                Text(
                    text = "MOBILE IS LOST",
                    fontSize = 28.sp,
                    fontWeight = FontWeight.Black,
                    color = Color(0xFFEF4444),
                    textAlign = TextAlign.Center,
                    letterSpacing = 2.sp
                )

                Text(
                    text = "This device has been reported LOST or STOLEN.\nAll device features and settings are locked.",
                    fontSize = 14.sp,
                    color = Color(0xFFCBD5E1),
                    textAlign = TextAlign.Center,
                    lineHeight = 22.sp,
                    fontWeight = FontWeight.Medium
                )
            }

            // Middle Section: Prominent "Call Owner" Card
            Card(
                colors = CardDefaults.cardColors(containerColor = Color(0xFF0F172A)),
                shape = RoundedCornerShape(24.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .border(1.5.dp, Color(0xFF38BDF8).copy(alpha = 0.4f), RoundedCornerShape(24.dp))
            ) {
                Column(
                    modifier = Modifier.padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    Text(
                        text = "PLEASE CALL THE OWNER",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = Color(0xFF94A3B8),
                        letterSpacing = 1.5.sp
                    )

                    Text(
                        text = ownerPhone,
                        fontSize = 32.sp,
                        fontWeight = FontWeight.Black,
                        color = Color(0xFF38BDF8),
                        textAlign = TextAlign.Center,
                        letterSpacing = 1.5.sp
                    )

                    Text(
                        text = "If you found this phone, tap the button below to reach the owner directly.",
                        fontSize = 12.sp,
                        color = Color(0xFF64748B),
                        textAlign = TextAlign.Center,
                        lineHeight = 18.sp
                    )

                    Button(
                        onClick = onCallOwner,
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF10B981)),
                        shape = RoundedCornerShape(16.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(60.dp)
                    ) {
                        Text(
                            text = "📞  CALL OWNER NOW",
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Black,
                            color = Color.White,
                            letterSpacing = 1.sp
                        )
                    }
                }
            }

            // Bottom Section: Status Pill
            Surface(
                color = Color(0xFF0F172A).copy(alpha = 0.8f),
                shape = RoundedCornerShape(30.dp),
                border = androidx.compose.foundation.BorderStroke(1.dp, Color(0xFF334155)),
                modifier = Modifier.padding(bottom = 12.dp)
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 18.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text("🛡️", fontSize = 14.sp)
                    Text(
                        text = "Locked Remotely • Unlock from AuraFind Web Interface",
                        fontSize = 11.sp,
                        color = Color(0xFF94A3B8),
                        fontWeight = FontWeight.SemiBold
                    )
                }
            }
        }
    }
}
