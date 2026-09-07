package com.findmydevice.security.ui.screens

import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
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
    var selectedTab by remember { mutableStateOf(0) }
    var isTrackingActive by remember { mutableStateOf(true) }
    var showAdminDialog by remember { mutableStateOf(false) }
    var showMenu by remember { mutableStateOf(false) }
    var deviceName by remember {
        mutableStateOf(
            if (android.os.Build.MODEL.contains("RMX", ignoreCase = true)) "Realme Device"
            else "Motorola Moto Edge 50 Fusion"
        )
    }

    val networkType = NetworkUtils.getNetworkType(context)
    val isGpsEnabled = NetworkUtils.isGpsEnabled(context)
    val isSimPresent = NetworkUtils.isSimPresent(context)

    Scaffold(
        topBar = {
            Column(modifier = Modifier.background(Color(0xFF0F172A))) {
                TopAppBar(
                    title = {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Surface(
                                shape = CircleShape,
                                color = Color(0xFF0284C7).copy(alpha = 0.2f),
                                modifier = Modifier.size(32.dp)
                            ) {
                                Box(contentAlignment = Alignment.Center) {
                                    Text("🛡️", fontSize = 16.sp)
                                }
                            }
                            Text(
                                "AuraFind Security",
                                fontWeight = FontWeight.Bold,
                                color = Color.White,
                                fontSize = 18.sp
                            )
                        }
                    },
                    actions = {
                        Box {
                            IconButton(onClick = { showMenu = true }) {
                                Icon(
                                    imageVector = Icons.Default.MoreVert,
                                    contentDescription = "Settings",
                                    tint = Color(0xFF94A3B8)
                                )
                            }
                            DropdownMenu(
                                expanded = showMenu,
                                onDismissRequest = { showMenu = false },
                                modifier = Modifier.background(Color(0xFF1E293B))
                            ) {
                                DropdownMenuItem(
                                    text = { Text("⚙️ Advanced Diagnostics", color = Color.White, fontSize = 13.sp) },
                                    onClick = {
                                        showMenu = false
                                        showAdminDialog = true
                                    }
                                )
                            }
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = Color(0xFF0F172A))
                )
                TabRow(
                    selectedTabIndex = selectedTab,
                    containerColor = Color(0xFF1E293B),
                    contentColor = Color(0xFF38BDF8)
                ) {
                    Tab(
                        selected = selectedTab == 0,
                        onClick = { selectedTab = 0 },
                        text = {
                            Text(
                                "📡 Telemetry",
                                fontWeight = if (selectedTab == 0) FontWeight.Bold else FontWeight.Normal,
                                color = if (selectedTab == 0) Color(0xFF38BDF8) else Color(0xFF94A3B8)
                            )
                        }
                    )
                    Tab(
                        selected = selectedTab == 1,
                        onClick = { selectedTab = 1 },
                        text = {
                            Text(
                                "🛡️ Privacy Center",
                                fontWeight = if (selectedTab == 1) FontWeight.Bold else FontWeight.Normal,
                                color = if (selectedTab == 1) Color(0xFF38BDF8) else Color(0xFF94A3B8)
                            )
                        }
                    )
                }
            }
        },
        containerColor = Color(0xFF0F172A)
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            if (selectedTab == 0) {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp)
                ) {
                    // 1. Protection Status Banner
                    Card(
                        colors = CardDefaults.cardColors(containerColor = Color(0xFF1E293B)),
                        shape = RoundedCornerShape(18.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(modifier = Modifier.padding(18.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Column {
                                    Text(deviceName, fontSize = 16.sp, fontWeight = FontWeight.Bold, color = Color.White)
                                    Text("Device ID Linked & Synced", fontSize = 11.sp, color = Color(0xFF64748B))
                                }
                                Surface(
                                    color = Color(0xFF10B981).copy(alpha = 0.15f),
                                    shape = RoundedCornerShape(10.dp)
                                ) {
                                    Row(
                                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                                    ) {
                                        Surface(shape = CircleShape, color = Color(0xFF10B981), modifier = Modifier.size(7.dp)) {}
                                        Text(
                                            "ACTIVE & ARMED",
                                            color = Color(0xFF10B981),
                                            fontWeight = FontWeight.Black,
                                            fontSize = 11.sp
                                        )
                                    }
                                }
                            }

                            Spacer(modifier = Modifier.height(16.dp))

                            // Diagnostic Grid
                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Column {
                                    Text("NETWORK", fontSize = 10.sp, fontWeight = FontWeight.Bold, color = Color(0xFF64748B))
                                    Text(networkType, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
                                }
                                Column {
                                    Text("GPS SATELLITE", fontSize = 10.sp, fontWeight = FontWeight.Bold, color = Color(0xFF64748B))
                                    Text(if (isGpsEnabled) "LOCKED" else "STANDBY", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = if (isGpsEnabled) Color(0xFF10B981) else Color(0xFFF59E0B))
                                }
                                Column {
                                    Text("SIM DETECTOR", fontSize = 10.sp, fontWeight = FontWeight.Bold, color = Color(0xFF64748B))
                                    Text(if (isSimPresent) "SECURED" else "ABSENT", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = if (isSimPresent) Color(0xFF38BDF8) else Color(0xFFEF4444))
                                }
                            }
                        }
                    }

                    // 2. Continuous Protection Details
                    Card(
                        colors = CardDefaults.cardColors(containerColor = Color(0xFF1E293B)),
                        shape = RoundedCornerShape(18.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(modifier = Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Text("🛡️ Real-Time Guardian", fontWeight = FontWeight.Bold, color = Color.White, fontSize = 14.sp)
                            Text(
                                "AuraFind is actively guarding this handset in the background with continuous GPS telemetry, tamper alarms, and cloud synchronization.",
                                fontSize = 12.sp,
                                color = Color(0xFF94A3B8),
                                lineHeight = 18.sp
                            )
                        }
                    }

                    // 3. Emergency Siren Test
                    Card(
                        colors = CardDefaults.cardColors(containerColor = Color(0xFF1E293B)),
                        shape = RoundedCornerShape(18.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(modifier = Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Text("🔊 Acoustic Alert Check", fontWeight = FontWeight.Bold, color = Color.White, fontSize = 14.sp)
                            OutlinedButton(
                                onClick = {
                                    AudioAlarmManager.playAlarm(context, 5)
                                },
                                shape = RoundedCornerShape(12.dp),
                                colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFFF59E0B)),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text("Test Emergency Alarm (5s Sound Check)", fontWeight = FontWeight.Bold, fontSize = 13.sp)
                            }
                        }
                    }
                }
            } else {
                SecurityPrivacyScreen()
            }
        }
    }

    // Hidden Admin / Maintenance Dialog
    if (showAdminDialog) {
        AlertDialog(
            onDismissRequest = { showAdminDialog = false },
            containerColor = Color(0xFF1E293B),
            title = {
                Text("⚙️ Advanced Diagnostics", color = Color.White, fontWeight = FontWeight.Bold)
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(
                        "Background Protection Service is currently: ${if (isTrackingActive) "RUNNING" else "STOPPED"}",
                        color = Color(0xFF94A3B8),
                        fontSize = 13.sp
                    )
                    Text(
                        "Only stop this service if performing low-level manual testing.",
                        color = Color(0xFFF87171),
                        fontSize = 11.sp
                    )
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
                            showAdminDialog = false
                        },
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (isTrackingActive) Color(0xFFDC2626) else Color(0xFF0284C7)
                        ),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(if (isTrackingActive) "Stop Service (Maintenance)" else "Start Service")
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showAdminDialog = false }) {
                    Text("Close", color = Color(0xFF38BDF8), fontWeight = FontWeight.Bold)
                }
            }
        )
    }
}

