package com.findmydevice.security.ui

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.findmydevice.security.data.network.ApiService
import com.findmydevice.security.data.network.SnapshotCreateRequest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

class LostModeOverlayActivity : ComponentActivity() {

    // Re-show overlay when screen wakes from power-button press
    private val screenOnReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val prefs = getSharedPreferences("aurafind_prefs", Context.MODE_PRIVATE)
            if (prefs.getBoolean("is_lost_mode", false)) {
                enforceImmersive()
                window.addFlags(
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD or
                    WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                )
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Always show over lock-screen when woken by power button
        setShowWhenLocked(true)
        setTurnScreenOn(true)

        window.addFlags(
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
            WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD or
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
        )

        enforceImmersive()

        val prefs = getSharedPreferences("aurafind_prefs", Context.MODE_PRIVATE)
        // Read owner's alternate contact + master exit key from prefs (set by LocationService when ENABLE_LOST_MODE arrives)
        val ownerPhone  = intent.getStringExtra("EMERGENCY_NUMBER")?.ifBlank { null }
            ?: prefs.getString("lost_mode_phone", null)
            ?: "Owner Contact"
        val masterKey   = prefs.getString("lost_mode_key", "944095") ?: "944095"

        // Register screen-on / user-present receivers
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_USER_PRESENT)
        }
        registerReceiver(screenOnReceiver, filter)

        setContent {
            LostModeScreen(
                ownerPhone  = ownerPhone,
                masterKey   = masterKey,
                onUnlockSuccess = {
                    // Exit lost mode – clear prefs and dismiss
                    prefs.edit().putBoolean("is_lost_mode", false).apply()
                    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
                    nm.cancel(9999)
                    finish()
                },
                onIntruderDetected = { triggerIntruderAlert() }
            )
        }
    }

    /** Full immersive sticky: hides status bar, nav bar – power button still works but overlay re-surfaces */
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

    // ── Block back button completely ─────────────────────────────────────────
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() { /* blocked */ }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        // Intercept HOME and RECENTS so thief can't switch apps
        if (keyCode == KeyEvent.KEYCODE_HOME || keyCode == KeyEvent.KEYCODE_APP_SWITCH) return true
        return super.onKeyDown(keyCode, event)
    }

    override fun onPause() {
        super.onPause()
        val prefs = getSharedPreferences("aurafind_prefs", Context.MODE_PRIVATE)
        if (prefs.getBoolean("is_lost_mode", false)) {
            // If still in lost mode and something paused us, bring back to front immediately
            val relaunch = Intent(applicationContext, LostModeOverlayActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            }
            startActivity(relaunch)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        try { unregisterReceiver(screenOnReceiver) } catch (e: Exception) {}
    }

    private fun triggerIntruderAlert() {
        CoroutineScope(Dispatchers.IO).launch {
            val prefs = getSharedPreferences("aurafind_prefs", Context.MODE_PRIVATE)
            val deviceId    = prefs.getString("device_id", null)
            val deviceToken = prefs.getString("device_token", null)
            if (deviceId != null && deviceToken != null) {
                try {
                    val retrofit = Retrofit.Builder()
                        .baseUrl("https://aurafind-security.onrender.com/")
                        .addConverterFactory(GsonConverterFactory.create())
                        .build()
                    val apiService = retrofit.create(ApiService::class.java)
                    val placeholder = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
                    apiService.createSnapshot(
                        deviceId    = deviceId,
                        deviceToken = deviceToken,
                        request = SnapshotCreateRequest(
                            image_data         = placeholder,
                            latitude           = 13.9481,
                            longitude          = 79.3429,
                            is_intruder_alert  = true
                        )
                    )
                } catch (e: Exception) { e.printStackTrace() }
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Composable UI
// ═══════════════════════════════════════════════════════════════════════════════
@Composable
fun LostModeScreen(
    ownerPhone       : String,
    masterKey        : String,
    onUnlockSuccess  : () -> Unit,
    onIntruderDetected: () -> Unit
) {
    val context = LocalContext.current
    var keyText        by remember { mutableStateOf("") }
    var failedAttempts by remember { mutableStateOf(0) }
    var errorMsg       by remember { mutableStateOf("") }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    colors = listOf(Color(0xFF050A14), Color(0xFF0B1220), Color(0xFF0F172A))
                )
            ),
        contentAlignment = Alignment.Center
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(24.dp)
        ) {

            // ── Red warning icon ──────────────────────────────────────────────
            Surface(
                color  = Color(0xFFEF4444).copy(alpha = 0.18f),
                shape  = CircleShape,
                modifier = Modifier.size(88.dp)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Text("🔒", fontSize = 44.sp)
                }
            }

            // ── Title ─────────────────────────────────────────────────────────
            Text(
                text       = "⚠️  DEVICE IN LOST MODE",
                fontSize   = 22.sp,
                fontWeight = FontWeight.Black,
                color      = Color(0xFFF87171),
                textAlign  = TextAlign.Center,
                letterSpacing = 1.2.sp
            )

            Text(
                text      = "This device has been reported LOST or STOLEN.\nAll unauthorized use is being monitored and recorded.",
                fontSize  = 13.sp,
                color     = Color(0xFF94A3B8),
                textAlign = TextAlign.Center,
                lineHeight = 20.sp
            )

            // ── Call Owner Card ───────────────────────────────────────────────
            Card(
                colors   = CardDefaults.cardColors(containerColor = Color(0xFF0F2040)),
                shape    = RoundedCornerShape(20.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier.padding(20.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Text(
                        "PLEASE CONTACT THE OWNER",
                        fontSize  = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color     = Color(0xFF64748B),
                        letterSpacing = 1.5.sp
                    )

                    Text(
                        text       = ownerPhone,
                        fontSize   = 30.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color      = Color(0xFF38BDF8),
                        textAlign  = TextAlign.Center,
                        letterSpacing = 2.sp
                    )

                    Button(
                        onClick = {
                            val dialIntent = Intent(Intent.ACTION_DIAL, Uri.parse("tel:$ownerPhone")).apply {
                                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                            }
                            context.startActivity(dialIntent)
                        },
                        colors   = ButtonDefaults.buttonColors(containerColor = Color(0xFF10B981)),
                        shape    = RoundedCornerShape(16.dp),
                        modifier = Modifier.fillMaxWidth().height(56.dp)
                    ) {
                        Text(
                            "📞  CALL OWNER NOW",
                            fontSize   = 17.sp,
                            fontWeight = FontWeight.Black,
                            color      = Color.White
                        )
                    }
                }
            }

            HorizontalDivider(color = Color(0xFF1E293B), thickness = 1.dp)

            // ── Exit Lost Mode (key entry) ────────────────────────────────────
            Card(
                colors   = CardDefaults.cardColors(containerColor = Color(0xFF0F172A)),
                shape    = RoundedCornerShape(20.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier.padding(20.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Text(
                        "OWNER EXIT CODE",
                        fontSize   = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color      = Color(0xFF64748B),
                        letterSpacing = 1.5.sp
                    )

                    OutlinedTextField(
                        value       = keyText,
                        onValueChange = {
                            keyText  = it
                            errorMsg = ""
                        },
                        label = { Text("Enter exit key", color = Color(0xFF64748B)) },
                        singleLine  = true,
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor    = Color.White,
                            unfocusedTextColor  = Color.White,
                            focusedBorderColor  = Color(0xFF3B82F6),
                            unfocusedBorderColor = Color(0xFF334155)
                        ),
                        modifier = Modifier.fillMaxWidth()
                    )

                    if (errorMsg.isNotEmpty()) {
                        Text(
                            errorMsg,
                            color      = Color(0xFFF87171),
                            fontSize   = 12.sp,
                            fontWeight = FontWeight.Bold,
                            textAlign  = TextAlign.Center
                        )
                    }

                    Button(
                        onClick = {
                            if (keyText.trim() == masterKey) {
                                onUnlockSuccess()
                            } else {
                                failedAttempts++
                                if (failedAttempts >= 3) {
                                    errorMsg = "⚠️ 3 Failed Attempts! Intruder activity reported!"
                                    onIntruderDetected()
                                } else {
                                    errorMsg = "Wrong key · ${3 - failedAttempts} attempt(s) left"
                                }
                                keyText = ""
                            }
                        },
                        colors   = ButtonDefaults.buttonColors(containerColor = Color(0xFF1D4ED8)),
                        shape    = RoundedCornerShape(14.dp),
                        modifier = Modifier.fillMaxWidth().height(52.dp)
                    ) {
                        Text(
                            "🔓  EXIT LOST MODE",
                            fontSize   = 15.sp,
                            fontWeight = FontWeight.Black,
                            color      = Color.White
                        )
                    }
                }
            }
        }
    }
}
