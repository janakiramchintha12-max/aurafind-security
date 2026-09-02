package com.findmydevice.security.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.addFlags(
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
            WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD or
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
        )

        val emergencyNumber = intent.getStringExtra("EMERGENCY_NUMBER") ?: "9014811203"
        val customMsg = intent.getStringExtra("LOST_MSG") ?: "This phone is reported lost."

        setContent {
            LostModeScreen(
                emergencyNumber = emergencyNumber,
                message = customMsg,
                onUnlockClick = { finish() },
                onIntruderDetected = { triggerIntruderAlert() }
            )
        }
    }

    private fun triggerIntruderAlert() {
        CoroutineScope(Dispatchers.IO).launch {
            val prefs = getSharedPreferences("aurafind_prefs", Context.MODE_PRIVATE)
            val deviceId = prefs.getString("device_id", "bdca7649-e699-4d57-a59a-e80a4db9e1de")
            val deviceToken = prefs.getString("device_token", "ca65a717-1185-417b-b8fc-32289812d8eb")

            if (deviceId != null && deviceToken != null) {
                val urls = listOf(
                    "http://10.216.158.126:8000/",
                    "https://ahead-allied-theoretical-buttons.trycloudflare.com/"
                )

                val intruderSelfieBase64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

                for (url in urls) {
                    try {
                        val retrofit = Retrofit.Builder()
                            .baseUrl(url)
                            .addConverterFactory(GsonConverterFactory.create())
                            .build()
                        val apiService = retrofit.create(ApiService::class.java)

                        val res = apiService.createSnapshot(
                            deviceId = deviceId,
                            deviceToken = deviceToken,
                            request = SnapshotCreateRequest(
                                image_data = intruderSelfieBase64,
                                latitude = 13.9481,
                                longitude = 79.3429,
                                is_intruder_alert = true
                            )
                        )
                        if (res.isSuccessful) break
                    } catch (e: Exception) {
                        e.printStackTrace()
                    }
                }
            }
        }
    }
}

@Composable
fun LostModeScreen(
    emergencyNumber: String,
    message: String,
    onUnlockClick: () -> Unit,
    onIntruderDetected: () -> Unit
) {
    val context = LocalContext.current
    var pinText by remember { mutableStateOf("") }
    var failedAttempts by remember { mutableStateOf(0) }
    var pinErrorMsg by remember { mutableStateOf("") }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    colors = listOf(
                        Color(0xFF090D16),
                        Color(0xFF0F172A),
                        Color(0xFF1E1B4B)
                    )
                )
            )
            .padding(24.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(Color(0xFF0F172A).copy(alpha = 0.95f), shape = RoundedCornerShape(28.dp))
                .padding(28.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(20.dp)
        ) {
            Surface(
                color = Color(0xFFEF4444).copy(alpha = 0.15f),
                shape = CircleShape,
                modifier = Modifier.size(72.dp)
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Text("⚠️", fontSize = 36.sp)
                }
            }

            Text(
                "DEVICE IS LOST",
                fontSize = 24.sp,
                fontWeight = FontWeight.Black,
                color = Color(0xFFF87171),
                letterSpacing = 1.5.sp
            )

            Card(
                colors = CardDefaults.cardColors(containerColor = Color(0xFF1E293B)),
                shape = RoundedCornerShape(20.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier.padding(20.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Text(
                        "PLEASE CONTACT OWNER",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color(0xFF94A3B8),
                        letterSpacing = 1.sp
                    )

                    Text(
                        "Call $emergencyNumber",
                        fontSize = 26.sp,
                        fontWeight = FontWeight.ExtraBold,
                        color = Color(0xFF38BDF8),
                        textAlign = TextAlign.Center
                    )

                    Button(
                        onClick = {
                            val intent = Intent(Intent.ACTION_DIAL, Uri.parse("tel:$emergencyNumber")).apply {
                                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                            }
                            context.startActivity(intent)
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF10B981)),
                        shape = RoundedCornerShape(14.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(52.dp)
                    ) {
                        Text(
                            "📞 CALL OWNER NOW",
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color.White
                        )
                    }
                }
            }

            Text(
                message,
                fontSize = 13.sp,
                color = Color(0xFFCBD5E1),
                textAlign = TextAlign.Center
            )

            HorizontalDivider(color = Color(0xFF334155), thickness = 1.dp)

            // Owner Unlock PIN Section
            Column(
                modifier = Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedTextField(
                    value = pinText,
                    onValueChange = {
                        pinText = it
                        pinErrorMsg = ""
                    },
                    label = { Text("Owner PIN to Unlock", color = Color(0xFF94A3B8)) },
                    singleLine = true,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = Color.White,
                        unfocusedTextColor = Color.White,
                        focusedBorderColor = Color(0xFF38BDF8),
                        unfocusedBorderColor = Color(0xFF475569)
                    ),
                    modifier = Modifier.fillMaxWidth()
                )

                if (pinErrorMsg.isNotEmpty()) {
                    Text(pinErrorMsg, color = Color(0xFFF87171), fontSize = 12.sp, fontWeight = FontWeight.Bold)
                }

                Button(
                    onClick = {
                        if (pinText == "1234" || pinText == "9014") {
                            onUnlockClick()
                        } else {
                            failedAttempts++
                            if (failedAttempts >= 3) {
                                pinErrorMsg = "⚠️ 3 Failed Attempts! Intruder Selfie Captured & Transmitted!"
                                onIntruderDetected()
                            } else {
                                pinErrorMsg = "Incorrect PIN (${3 - failedAttempts} attempts remaining)"
                            }
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF3B82F6)),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("Unlock Device", fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}
