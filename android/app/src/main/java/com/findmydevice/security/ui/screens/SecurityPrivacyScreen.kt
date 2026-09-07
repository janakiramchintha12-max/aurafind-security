package com.findmydevice.security.ui.screens

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import com.findmydevice.security.util.PrivacyManager

@Composable
fun SecurityPrivacyScreen() {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences("aurafind_prefs", Context.MODE_PRIVATE) }
    val deviceId = prefs.getString("device_id", null)
    val deviceToken = prefs.getString("device_token", null)

    var cameraPaused by remember { mutableStateOf(PrivacyManager.isCameraPaused(context)) }
    var micPaused by remember { mutableStateOf(PrivacyManager.isMicPaused(context)) }
    var locationPaused by remember { mutableStateOf(PrivacyManager.isLocationPaused(context)) }
    var speakerPaused by remember { mutableStateOf(PrivacyManager.isSpeakerPaused(context)) }
    var controlsRestricted by remember { mutableStateOf(PrivacyManager.isControlsRestricted(context)) }
    var activityLogs by remember { mutableStateOf(PrivacyManager.getActivityLogs(context)) }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF0F172A))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item {
            // Header Card
            Card(
                colors = CardDefaults.cardColors(containerColor = Color(0xFF1E293B)),
                shape = RoundedCornerShape(18.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(
                        "🛡️ Security & Privacy Control Center",
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color.White
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        "You control whether remote administrators can access sensitive sensors. Device privacy state is authoritative and cannot be overridden remotely.",
                        fontSize = 12.sp,
                        color = Color(0xFF94A3B8)
                    )
                }
            }
        }

        item {
            Text(
                "SENSITIVE SENSOR PERMISSIONS",
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                color = Color(0xFF38BDF8),
                letterSpacing = 1.sp
            )
        }

        item {
            PrivacyControlCard(
                title = "📷 Remote Camera Access",
                description = "Live streaming and remote snapshots.",
                isPaused = cameraPaused,
                onToggle = { isPaused ->
                    cameraPaused = isPaused
                    PrivacyManager.setCameraPaused(context, isPaused, null, deviceId, deviceToken)
                    activityLogs = PrivacyManager.getActivityLogs(context)
                }
            )
        }

        item {
            PrivacyControlCard(
                title = "🎙️ Remote Microphone & Intercom",
                description = "Two-way voice calls and remote listening.",
                isPaused = micPaused,
                onToggle = { isPaused ->
                    micPaused = isPaused
                    PrivacyManager.setMicPaused(context, isPaused, null, deviceId, deviceToken)
                    activityLogs = PrivacyManager.getActivityLogs(context)
                }
            )
        }

        item {
            PrivacyControlCard(
                title = "📍 Satellite Location Sharing",
                description = "Real-time GPS coordinate telemetry transmission.",
                isPaused = locationPaused,
                onToggle = { isPaused ->
                    locationPaused = isPaused
                    PrivacyManager.setLocationPaused(context, isPaused, null, deviceId, deviceToken)
                    activityLogs = PrivacyManager.getActivityLogs(context)
                }
            )
        }

        item {
            PrivacyControlCard(
                title = "🔊 Loudspeaker & Siren Alarm",
                description = "Remote siren alarm and voice megaphone TTS.",
                isPaused = speakerPaused,
                onToggle = { isPaused ->
                    speakerPaused = isPaused
                    PrivacyManager.setSpeakerPaused(context, isPaused, null, deviceId, deviceToken)
                    activityLogs = PrivacyManager.getActivityLogs(context)
                }
            )
        }

        item {
            PrivacyControlCard(
                title = "🔒 Remote Device Controls",
                description = "Remote screen lockdown and lost mode overlay.",
                isPaused = controlsRestricted,
                onToggle = { isRestricted ->
                    controlsRestricted = isRestricted
                    PrivacyManager.setControlsRestricted(context, isRestricted, null, deviceId, deviceToken)
                    activityLogs = PrivacyManager.getActivityLogs(context)
                }
            )
        }

        item {
            Spacer(modifier = Modifier.height(6.dp))
            Text(
                "RECENT PRIVACY ACTIVITY AUDIT",
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                color = Color(0xFF38BDF8),
                letterSpacing = 1.sp
            )
        }

        if (activityLogs.isEmpty()) {
            item {
                Card(
                    colors = CardDefaults.cardColors(containerColor = Color(0xFF1E293B)),
                    shape = RoundedCornerShape(14.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        "No recent privacy modifications.",
                        fontSize = 12.sp,
                        color = Color(0xFF64748B),
                        modifier = Modifier.padding(16.dp)
                    )
                }
            }
        } else {
            items(activityLogs) { (action, time) ->
                Card(
                    colors = CardDefaults.cardColors(containerColor = Color(0xFF1E293B)),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(12.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = action,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Medium,
                            color = Color.White,
                            modifier = Modifier.weight(1f)
                        )
                        Text(
                            text = time,
                            fontSize = 11.sp,
                            color = Color(0xFF38BDF8),
                            fontWeight = FontWeight.Bold
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun PrivacyControlCard(
    title: String,
    description: String,
    isPaused: Boolean,
    onToggle: (Boolean) -> Unit
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Color(0xFF1E293B)),
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = title,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color.White
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Surface(
                        color = if (isPaused) Color(0x33EF4444) else Color(0x3310B981),
                        shape = RoundedCornerShape(8.dp)
                    ) {
                        Text(
                            text = if (isPaused) "PAUSED" else "ALLOWED",
                            fontSize = 9.sp,
                            fontWeight = FontWeight.Black,
                            color = if (isPaused) Color(0xFFF87171) else Color(0xFF34D399),
                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                        )
                    }
                }
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = description,
                    fontSize = 11.sp,
                    color = Color(0xFF94A3B8)
                )
            }

            Switch(
                checked = !isPaused,
                onCheckedChange = { isAllowed -> onToggle(!isAllowed) },
                colors = SwitchDefaults.colors(
                    checkedThumbColor = Color(0xFF34D399),
                    checkedTrackColor = Color(0xFF065F46),
                    uncheckedThumbColor = Color(0xFFF87171),
                    uncheckedTrackColor = Color(0xFF7F1D1D)
                )
            )
        }
    }
}
