package com.findmydevice.security.ui.screens

import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.findmydevice.security.service.LocationService
import com.findmydevice.security.util.AudioAlarmManager
import com.findmydevice.security.util.NetworkUtils

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainScreen() {
    val context = LocalContext.current
    var isTrackingActive by remember { mutableStateOf(true) }
    var deviceName by remember { mutableStateOf("Janak's Pixel 8") }
    var serverUrl by remember { mutableStateOf("http://10.0.2.2:8000") }
    var pendingQueueCount by remember { mutableStateOf(0) }

    val networkType = NetworkUtils.getNetworkType(context)
    val isGpsEnabled = NetworkUtils.isGpsEnabled(context)
    val isSimPresent = NetworkUtils.isSimPresent(context)

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        "AuraFind Security",
                        fontWeight = FontWeight.Bold,
                        color = Color.White
                    )
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Color(0xFF0F172A))
            )
        },
        containerColor = Color(0xFF0F172A)
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Status Card
            Card(
                colors = CardDefaults.cardColors(containerColor = Color(0xFF1E293B)),
                shape = RoundedCornerShape(16.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(deviceName, fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Color.White)
                        Surface(
                            color = if (isTrackingActive) Color(0xFF10B981).copy(alpha = 0.2f) else Color(0xFFEF4444).copy(alpha = 0.2f),
                            shape = RoundedCornerShape(8.dp)
                        ) {
                            Text(
                                if (isTrackingActive) "PROTECTED" else "PAUSED",
                                color = if (isTrackingActive) Color(0xFF10B981) else Color(0xFFEF4444),
                                fontWeight = FontWeight.Bold,
                                fontSize = 12.sp,
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(12.dp))

                    Text("Network: $networkType", fontSize = 13.sp, color = Color(0xFF94A3B8))
                    Text("GPS Sensor: ${if (isGpsEnabled) "ACTIVE" else "DISABLED"}", fontSize = 13.sp, color = Color(0xFF94A3B8))
                    Text("SIM Card: ${if (isSimPresent) "DETECTED" else "ABSENT"}", fontSize = 13.sp, color = Color(0xFF94A3B8))
                    Text("Offline Location Queue: $pendingQueueCount records", fontSize = 13.sp, color = Color(0xFF38BDF8))
                }
            }

            // Controls Card
            Card(
                colors = CardDefaults.cardColors(containerColor = Color(0xFF1E293B)),
                shape = RoundedCornerShape(16.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Service Controls", fontWeight = FontWeight.Bold, color = Color.White)

                    Button(
                        onClick = {
                            isTrackingActive = !isTrackingActive
                            val intent = Intent(context, LocationService::class.java)
                            if (isTrackingActive) {
                                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                                    context.startForegroundService(intent)
                                } else {
                                    context.startService(intent)
                                }
                            } else {
                                context.stopService(intent)
                            }
                        },
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (isTrackingActive) Color(0xFFDC2626) else Color(0xFF0284C7)
                        ),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(if (isTrackingActive) "Stop Background Protection" else "Start Background Protection")
                    }

                    OutlinedButton(
                        onClick = {
                            AudioAlarmManager.playAlarm(context, 10)
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("Test Emergency Alarm Sound", color = Color(0xFFF59E0B))
                    }
                }
            }
        }
    }
}
