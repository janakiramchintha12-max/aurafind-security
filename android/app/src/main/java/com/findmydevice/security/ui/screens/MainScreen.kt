package com.findmydevice.security.ui.screens

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.widget.Toast
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.findmydevice.security.data.network.ApiService
import com.findmydevice.security.data.network.AutoPairRequest
import com.findmydevice.security.data.network.StatusUpdateRequest
import com.findmydevice.security.util.PrivacyManager
import com.findmydevice.security.service.LocationService
import com.findmydevice.security.util.AudioAlarmManager
import com.findmydevice.security.util.NetworkUtils
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainScreen() {
    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()
    val prefs = remember { context.getSharedPreferences("aurafind_prefs", Context.MODE_PRIVATE) }

    var selectedTab by remember { mutableStateOf(0) }
    var isTrackingActive by remember { mutableStateOf(true) }
    var showConfigDialog by remember { mutableStateOf(false) }
    var showPairSuccessDialog by remember { mutableStateOf(false) }
    var showMenu by remember { mutableStateOf(false) }
    var isPairingLoading by remember { mutableStateOf(false) }
    var statusMessage by remember { mutableStateOf<String?>(null) }

    // Live state from preferences (auto-initialized to cloud & hardware ID)
    var savedDeviceId by remember { mutableStateOf(NetworkUtils.getHardwareDeviceId(context)) }
    var savedDeviceToken by remember { mutableStateOf(NetworkUtils.getHardwareDeviceToken(context)) }
    var savedServerUrl by remember {
        val rawUrl = prefs.getString("server_url", "https://aurafind-security.onrender.com") ?: "https://aurafind-security.onrender.com"
        val clean = if (rawUrl.contains("192.168.31.94") || rawUrl.isBlank()) "https://aurafind-security.onrender.com" else rawUrl
        mutableStateOf(clean)
    }

    val isPaired = savedDeviceId.isNotBlank() && savedDeviceToken.isNotBlank()
    val deviceModelName = NetworkUtils.getHardwareDeviceName()

    val networkType = NetworkUtils.getNetworkType(context)
    val isGpsEnabled = NetworkUtils.isGpsEnabled(context)
    val isSimPresent = NetworkUtils.isSimPresent(context)
    var isLocationPaused by remember { mutableStateOf(PrivacyManager.isLocationPaused(context)) }
    var simDetails by remember { mutableStateOf(NetworkUtils.getSimDetails(context)) }

    fun triggerQuickStatusSync() {
        coroutineScope.launch(Dispatchers.IO) {
            try {
                val okHttp = okhttp3.OkHttpClient.Builder()
                    .connectTimeout(5, java.util.concurrent.TimeUnit.SECONDS)
                    .build()
                val targetUrl = NetworkUtils.BASE_URL
                val retrofit = Retrofit.Builder()
                    .baseUrl(targetUrl)
                    .client(okHttp)
                    .addConverterFactory(GsonConverterFactory.create())
                    .build()
                val api = retrofit.create(ApiService::class.java)
                val devId = NetworkUtils.getHardwareDeviceId(context)
                val devTok = NetworkUtils.getHardwareDeviceToken(context)
                val currentSim = NetworkUtils.getSimDetails(context)
                api.updateDeviceStatus(
                    deviceId = devId,
                    deviceToken = devTok,
                    request = StatusUpdateRequest(
                        device_name = NetworkUtils.getHardwareDeviceName(),
                        device_model = Build.MODEL ?: "Android Handset",
                        android_version = Build.VERSION.RELEASE ?: "14",
                        sim_status = currentSim.isSimPresent,
                        sim_number = currentSim.summary,
                        location_privacy_state = PrivacyManager.getLocationState(context)
                    )
                )
            } catch (_: Exception) {}
        }
    }

    // Animated radar pulse
    val infiniteTransition = rememberInfiniteTransition(label = "RadarPulse")
    val pulseScale by infiniteTransition.animateFloat(
        initialValue = 0.95f,
        targetValue = 1.08f,
        animationSpec = infiniteRepeatable(
            animation = tween(1400, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "PulseScale"
    )

    // Helper: restart location service with fresh credentials
    fun restartService() {
        try {
            val intent = Intent(context, LocationService::class.java)
            context.stopService(intent)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    // Helper: auto-pair with target server
    fun autoPairToServer(targetUrl: String) {
        var cleanUrl = targetUrl.trim()
        if (cleanUrl.endsWith("/download")) {
            cleanUrl = cleanUrl.substringBeforeLast("/download")
        }
        if (cleanUrl.endsWith("/download/app.apk")) {
            cleanUrl = cleanUrl.substringBeforeLast("/download/app.apk")
        }
        if (!cleanUrl.endsWith("/")) cleanUrl += "/"

        isPairingLoading = true
        statusMessage = "Connecting to $cleanUrl..."

        coroutineScope.launch(Dispatchers.IO) {
            try {
                val okHttp = okhttp3.OkHttpClient.Builder()
                    .connectTimeout(15, java.util.concurrent.TimeUnit.SECONDS)
                    .readTimeout(20, java.util.concurrent.TimeUnit.SECONDS)
                    .build()

                val retrofit = Retrofit.Builder()
                    .baseUrl(cleanUrl)
                    .client(okHttp)
                    .addConverterFactory(GsonConverterFactory.create())
                    .build()

                val api = retrofit.create(ApiService::class.java)
                val res = api.autoPair(
                    AutoPairRequest(
                        username = "admin",
                        password = "admin",
                        device_name = NetworkUtils.getHardwareDeviceName(),
                        device_model = Build.MODEL ?: "Android Handset",
                        android_version = Build.VERSION.RELEASE ?: "14.0",
                        app_version = "1.0.0"
                    )
                )

                withContext(Dispatchers.Main) {
                    isPairingLoading = false
                    if (res.isSuccessful && res.body() != null) {
                        val body = res.body()!!
                        prefs.edit()
                            .putString("server_url", cleanUrl)
                            .putString("device_id", body.device_id)
                            .putString("device_token", body.device_token)
                            .apply()

                        savedServerUrl = cleanUrl
                        savedDeviceId = body.device_id
                        savedDeviceToken = body.device_token

                        NetworkUtils.setServerUrl(cleanUrl)
                        restartService()

                        showPairSuccessDialog = true
                        statusMessage = "Paired with $cleanUrl"
                    } else {
                        val errorText = res.errorBody()?.string() ?: "HTTP ${res.code()}"
                        statusMessage = "Pairing rejected: $errorText"
                        Toast.makeText(context, "Pairing failed: $errorText", Toast.LENGTH_LONG).show()
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    isPairingLoading = false
                    statusMessage = "Connection error: ${e.message}"
                    Toast.makeText(context, "Error: ${e.message}", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    // Google Scanner QR Launcher
    fun launchGoogleQrScanner() {
        try {
            val options = GmsBarcodeScannerOptions.Builder()
                .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
                .enableAutoZoom()
                .build()

            val scanner = GmsBarcodeScanning.getClient(context, options)
            scanner.startScan()
                .addOnSuccessListener { barcode ->
                    val raw = barcode.rawValue ?: return@addOnSuccessListener
                    // Check if JSON payload from dashboard
                    if (raw.startsWith("{") && raw.contains("server_url")) {
                        try {
                            val json = JSONObject(raw)
                            val sUrl = json.optString("server_url", "https://aurafind-security.onrender.com")
                            val devId = json.optString("device_id")
                            val devToken = json.optString("device_token")

                            if (devId.isNotBlank() && devToken.isNotBlank()) {
                                prefs.edit()
                                    .putString("server_url", sUrl)
                                    .putString("device_id", devId)
                                    .putString("device_token", devToken)
                                    .apply()

                                savedServerUrl = sUrl
                                savedDeviceId = devId
                                savedDeviceToken = devToken

                                NetworkUtils.setServerUrl(sUrl)
                                restartService()

                                showPairSuccessDialog = true
                                return@addOnSuccessListener
                            } else {
                                autoPairToServer(sUrl)
                                return@addOnSuccessListener
                            }
                        } catch (e: Exception) {
                            // Fall through to URL pairing
                        }
                    }

                    // If URL scanned from dashboard screen
                    if (raw.startsWith("http://") || raw.startsWith("https://")) {
                        autoPairToServer(raw)
                    } else {
                        Toast.makeText(context, "Scanned: $raw", Toast.LENGTH_SHORT).show()
                    }
                }
                .addOnFailureListener { e ->
                    Toast.makeText(context, "Scanner cancelled or unavailable: ${e.message}", Toast.LENGTH_SHORT).show()
                }
        } catch (e: Exception) {
            Toast.makeText(context, "Scanner error: ${e.message}", Toast.LENGTH_LONG).show()
        }
    }

    Scaffold(
        topBar = {
            Column(modifier = Modifier.background(Color(0xFF070B14))) {
                TopAppBar(
                    title = {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Surface(
                                shape = CircleShape,
                                color = Color(0xFF00F2FE).copy(alpha = 0.15f),
                                modifier = Modifier.size(36.dp)
                            ) {
                                Box(contentAlignment = Alignment.Center) {
                                    Text("🛡️", fontSize = 18.sp)
                                }
                            }
                            Column {
                                Text(
                                    "AURAFIND // SENTINEL",
                                    fontWeight = FontWeight.Black,
                                    color = Color.White,
                                    fontSize = 16.sp,
                                    letterSpacing = 1.sp
                                )
                                Text(
                                    "TACTICAL MOBILE DEFENSE v2.5",
                                    fontSize = 10.sp,
                                    color = Color(0xFF00F2FE),
                                    fontWeight = FontWeight.Bold,
                                    letterSpacing = 1.sp
                                )
                            }
                        }
                    },
                    actions = {
                        Box {
                            IconButton(onClick = { showMenu = true }) {
                                Icon(
                                    imageVector = Icons.Default.MoreVert,
                                    contentDescription = "Menu",
                                    tint = Color(0xFF94A3B8)
                                )
                            }
                            DropdownMenu(
                                expanded = showMenu,
                                onDismissRequest = { showMenu = false },
                                modifier = Modifier.background(Color(0xFF0F172A))
                            ) {
                                DropdownMenuItem(
                                    text = { Text("📷 Scan Dashboard QR", color = Color.White, fontSize = 13.sp) },
                                    onClick = {
                                        showMenu = false
                                        launchGoogleQrScanner()
                                    }
                                )
                                DropdownMenuItem(
                                    text = { Text("⚙️ Server & Credentials", color = Color.White, fontSize = 13.sp) },
                                    onClick = {
                                        showMenu = false
                                        showConfigDialog = true
                                    }
                                )
                                DropdownMenuItem(
                                    text = { Text("⚡ Test Alarm Siren", color = Color.White, fontSize = 13.sp) },
                                    onClick = {
                                        showMenu = false
                                        AudioAlarmManager.playAlarm(context, 5)
                                    }
                                )
                            }
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = Color(0xFF070B14))
                )

                // High-Tech Navigation Tabs
                TabRow(
                    selectedTabIndex = selectedTab,
                    containerColor = Color(0xFF0F172A),
                    contentColor = Color(0xFF00F2FE),
                    divider = {}
                ) {
                    Tab(
                        selected = selectedTab == 0,
                        onClick = { selectedTab = 0 },
                        text = {
                            Text(
                                "📡 TACTICAL RADAR",
                                fontWeight = if (selectedTab == 0) FontWeight.Black else FontWeight.Normal,
                                color = if (selectedTab == 0) Color(0xFF00F2FE) else Color(0xFF64748B),
                                fontSize = 12.sp,
                                letterSpacing = 1.sp
                            )
                        }
                    )
                    Tab(
                        selected = selectedTab == 1,
                        onClick = { selectedTab = 1 },
                        text = {
                            Text(
                                "🛡️ CYBER PRIVACY",
                                fontWeight = if (selectedTab == 1) FontWeight.Black else FontWeight.Normal,
                                color = if (selectedTab == 1) Color(0xFF00F2FE) else Color(0xFF64748B),
                                fontSize = 12.sp,
                                letterSpacing = 1.sp
                            )
                        }
                    )
                }
            }
        },
        containerColor = Color(0xFF070B14)
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            if (selectedTab == 0) {
                LazyColumn(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {

                    // 1. Futuristic Central Radar & Connection Orb
                    item {
                        Card(
                            colors = CardDefaults.cardColors(containerColor = Color(0xFF0F172A)),
                            shape = RoundedCornerShape(24.dp),
                            modifier = Modifier
                                .fillMaxWidth()
                                .border(1.dp, if (isPaired) Color(0xFF10B981).copy(alpha = 0.4f) else Color(0xFF00F2FE).copy(alpha = 0.4f), RoundedCornerShape(24.dp))
                        ) {
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(20.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(14.dp)
                            ) {
                                // Pulsing Radar Orb
                                Box(
                                    contentAlignment = Alignment.Center,
                                    modifier = Modifier.size(110.dp)
                                ) {
                                    // Outer pulse ring
                                    Box(
                                        modifier = Modifier
                                            .size(110.dp)
                                            .scale(pulseScale)
                                            .clip(CircleShape)
                                            .background(
                                                if (isPaired) Color(0xFF10B981).copy(alpha = 0.12f)
                                                else Color(0xFF00F2FE).copy(alpha = 0.12f)
                                            )
                                    )
                                    // Mid ring
                                    Box(
                                        modifier = Modifier
                                            .size(85.dp)
                                            .clip(CircleShape)
                                            .border(1.5.dp, if (isPaired) Color(0xFF10B981) else Color(0xFF00F2FE), CircleShape)
                                            .background(Color(0xFF070B14))
                                    )
                                    if (isPaired) {
                                        Icon(
                                            imageVector = Icons.Default.Lock,
                                            contentDescription = "Lock",
                                            tint = Color(0xFF10B981),
                                            modifier = Modifier.size(36.dp)
                                        )
                                    } else {
                                        Text("📷", fontSize = 36.sp)
                                    }
                                }

                                // Status text
                                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Text(
                                        if (isPaired) "ARMED & ONLINE" else "READY TO PAIR",
                                        fontSize = 17.sp,
                                        fontWeight = FontWeight.Black,
                                        color = if (isPaired) Color(0xFF10B981) else Color(0xFF00F2FE),
                                        letterSpacing = 1.5.sp
                                    )
                                    Text(
                                        if (isPaired) "Connected: $deviceModelName" else "Scan Dashboard QR Code to Connect",
                                        fontSize = 12.sp,
                                        color = Color(0xFF94A3B8),
                                        fontWeight = FontWeight.Medium
                                    )
                                    if (isPaired) {
                                        Text(
                                            "ID: ${savedDeviceId.take(12)}...",
                                            fontSize = 11.sp,
                                            fontFamily = FontFamily.Monospace,
                                            color = Color(0xFF64748B)
                                        )
                                    }
                                }

                                // Status Message Banner
                                if (statusMessage != null) {
                                    Surface(
                                        color = Color(0xFF1E293B),
                                        shape = RoundedCornerShape(10.dp),
                                        modifier = Modifier.fillMaxWidth()
                                    ) {
                                        Text(
                                            statusMessage!!,
                                            fontSize = 11.sp,
                                            color = Color(0xFF38BDF8),
                                            textAlign = TextAlign.Center,
                                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)
                                        )
                                    }
                                }
                            }
                        }
                    }

                    // 1.5. MOBILE LOCATION ON/OFF CONTROL SWITCH
                    item {
                        Card(
                            colors = CardDefaults.cardColors(
                                containerColor = if (!isLocationPaused) Color(0xFF06281E) else Color(0xFF2D1212)
                            ),
                            shape = RoundedCornerShape(20.dp),
                            modifier = Modifier
                                .fillMaxWidth()
                                .border(
                                    1.5.dp,
                                    if (!isLocationPaused) Color(0xFF10B981) else Color(0xFFEF4444),
                                    RoundedCornerShape(20.dp)
                                )
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(18.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Row(
                                    modifier = Modifier.weight(1f),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(14.dp)
                                ) {
                                    Surface(
                                        shape = CircleShape,
                                        color = if (!isLocationPaused) Color(0xFF10B981).copy(alpha = 0.2f) else Color(0xFFEF4444).copy(alpha = 0.2f),
                                        modifier = Modifier.size(46.dp)
                                    ) {
                                        Box(contentAlignment = Alignment.Center) {
                                            Text(if (!isLocationPaused) "📍" else "🛑", fontSize = 22.sp)
                                        }
                                    }
                                    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                            Text(
                                                "HANDSET LOCATION ACCESS",
                                                color = Color.White,
                                                fontWeight = FontWeight.Black,
                                                fontSize = 13.sp,
                                                letterSpacing = 0.5.sp
                                            )
                                        }
                                        Surface(
                                            color = if (!isLocationPaused) Color(0xFF10B981).copy(alpha = 0.2f) else Color(0xFFEF4444).copy(alpha = 0.2f),
                                            shape = RoundedCornerShape(6.dp)
                                        ) {
                                            Text(
                                                if (!isLocationPaused) "● TRACKING ACTIVE (ONLINE)" else "■ TRACKING PAUSED (OFFLINE)",
                                                color = if (!isLocationPaused) Color(0xFF10B981) else Color(0xFFEF4444),
                                                fontSize = 9.sp,
                                                fontWeight = FontWeight.Black,
                                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                                            )
                                        }
                                        Text(
                                            if (!isLocationPaused)
                                                "Transmitting live satellite GPS coordinates to cloud dashboard."
                                            else
                                                "Location paused by you. Dashboard cannot track this phone until you turn this on.",
                                            color = Color(0xFF94A3B8),
                                            fontSize = 11.sp,
                                            lineHeight = 15.sp
                                        )
                                    }
                                }
                                Switch(
                                    checked = !isLocationPaused,
                                    onCheckedChange = { isChecked ->
                                        val willPause = !isChecked
                                        isLocationPaused = willPause
                                        PrivacyManager.setLocationPaused(context, willPause, null, savedDeviceId, savedDeviceToken)
                                        statusMessage = if (willPause) "Location sharing PAUSED on handset" else "Location sharing ACTIVE on handset"
                                        triggerQuickStatusSync()
                                    },
                                    colors = SwitchDefaults.colors(
                                        checkedThumbColor = Color.White,
                                        checkedTrackColor = Color(0xFF10B981),
                                        uncheckedThumbColor = Color.White,
                                        uncheckedTrackColor = Color(0xFFEF4444)
                                    )
                                )
                            }
                        }
                    }

                    // 1.8. DEDICATED CELLULAR SIM CARD TELEMETRY & SWAP DETECTION CARD
                    item {
                        Card(
                            colors = CardDefaults.cardColors(containerColor = Color(0xFF0F172A)),
                            shape = RoundedCornerShape(20.dp),
                            modifier = Modifier
                                .fillMaxWidth()
                                .border(
                                    1.dp,
                                    if (simDetails.isSimSwapped) Color(0xFFF59E0B) else Color(0xFF1E293B),
                                    RoundedCornerShape(20.dp)
                                )
                        ) {
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(18.dp),
                                verticalArrangement = Arrangement.spacedBy(12.dp)
                            ) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        Text("💳", fontSize = 18.sp)
                                        Text(
                                            "CELLULAR SIM CARD TELEMETRY",
                                            fontSize = 11.sp,
                                            fontWeight = FontWeight.Black,
                                            color = Color(0xFF64748B),
                                            letterSpacing = 1.sp
                                        )
                                    }
                                    Surface(
                                        color = if (simDetails.isSimSwapped) Color(0xFFF59E0B).copy(alpha = 0.2f)
                                                else if (simDetails.isSimPresent) Color(0xFF38BDF8).copy(alpha = 0.15f)
                                                else Color(0xFFEF4444).copy(alpha = 0.15f),
                                        shape = RoundedCornerShape(8.dp)
                                    ) {
                                        Text(
                                            if (simDetails.isSimSwapped) "⚠️ NEW SIM DETECTED"
                                            else if (simDetails.isSimPresent) "ACTIVE & VERIFIED"
                                            else "NO SIM INSERTED",
                                            color = if (simDetails.isSimSwapped) Color(0xFFF59E0B)
                                                    else if (simDetails.isSimPresent) Color(0xFF38BDF8)
                                                    else Color(0xFFEF4444),
                                            fontSize = 10.sp,
                                            fontWeight = FontWeight.Bold,
                                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                                        )
                                    }
                                }

                                if (simDetails.cards.isNotEmpty()) {
                                    simDetails.cards.forEach { card ->
                                        Row(
                                            modifier = Modifier
                                                .fillMaxWidth()
                                                .background(Color(0xFF1E293B).copy(alpha = 0.6f), RoundedCornerShape(12.dp))
                                                .padding(12.dp),
                                            horizontalArrangement = Arrangement.SpaceBetween,
                                            verticalAlignment = Alignment.CenterVertically
                                        ) {
                                            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                                    Surface(
                                                        color = Color(0xFF00F2FE).copy(alpha = 0.2f),
                                                        shape = RoundedCornerShape(4.dp)
                                                    ) {
                                                        Text(
                                                            "SLOT ${card.slotIndex + 1}",
                                                            color = Color(0xFF00F2FE),
                                                            fontSize = 9.sp,
                                                            fontWeight = FontWeight.Black,
                                                            modifier = Modifier.padding(horizontal = 5.dp, vertical = 2.dp)
                                                        )
                                                    }
                                                    Text(
                                                        card.displayName,
                                                        color = Color.White,
                                                        fontWeight = FontWeight.Bold,
                                                        fontSize = 13.sp
                                                    )
                                                }
                                                if (!card.phoneNumber.isNullOrBlank()) {
                                                    Text(
                                                        "Number: ${card.phoneNumber}",
                                                        color = Color(0xFF38BDF8),
                                                        fontSize = 11.sp,
                                                        fontWeight = FontWeight.SemiBold,
                                                        fontFamily = FontFamily.Monospace
                                                    )
                                                }
                                            }
                                            if (!card.countryIso.isNullOrBlank()) {
                                                Text(
                                                    card.countryIso,
                                                    color = Color(0xFF64748B),
                                                    fontSize = 11.sp,
                                                    fontWeight = FontWeight.Bold
                                                )
                                            }
                                        }
                                    }
                                } else {
                                    Text(
                                        "No physical or eSIM profile active in this handset.",
                                        color = Color(0xFF64748B),
                                        fontSize = 12.sp
                                    )
                                }

                                if (simDetails.isSimSwapped) {
                                    Surface(
                                        color = Color(0xFFF59E0B).copy(alpha = 0.12f),
                                        shape = RoundedCornerShape(10.dp),
                                        modifier = Modifier.fillMaxWidth()
                                    ) {
                                        Row(
                                            modifier = Modifier.padding(10.dp),
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.SpaceBetween
                                        ) {
                                            Column(modifier = Modifier.weight(1f)) {
                                                Text(
                                                    "🚨 SIM Card Change Alert",
                                                    color = Color(0xFFF59E0B),
                                                    fontSize = 11.sp,
                                                    fontWeight = FontWeight.Bold
                                                )
                                                Text(
                                                    "New SIM card detected: ${simDetails.summary.replace("⚠️ SWAPPED: ", "")}. Cloud dashboard has been notified.",
                                                    color = Color(0xFFCBD5E1),
                                                    fontSize = 10.sp
                                                )
                                            }
                                            TextButton(onClick = {
                                                NetworkUtils.resetSimSwappedState(context)
                                                simDetails = NetworkUtils.getSimDetails(context)
                                            }) {
                                                Text("Acknowledge", color = Color(0xFFF59E0B), fontSize = 11.sp, fontWeight = FontWeight.Bold)
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // 2. BIG GLOWING ACTION BUTTONS: SCAN QR CODE & AUTO-LINK
                    item {
                        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            
                            // PRIMARY: GOOGLE CODE SCANNER BUTTON
                            Button(
                                onClick = { launchGoogleQrScanner() },
                                colors = ButtonDefaults.buttonColors(containerColor = Color.Transparent),
                                contentPadding = PaddingValues(),
                                shape = RoundedCornerShape(16.dp),
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(58.dp)
                                    .background(
                                        Brush.horizontalGradient(listOf(Color(0xFF00F2FE), Color(0xFF0284C7))),
                                        RoundedCornerShape(16.dp)
                                    )
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.Center,
                                    modifier = Modifier.fillMaxSize()
                                ) {
                                    Text("📷", fontSize = 22.sp)
                                    Spacer(modifier = Modifier.width(10.dp))
                                    Column {
                                        Text(
                                            "SCAN DASHBOARD QR CODE",
                                            fontWeight = FontWeight.Black,
                                            fontSize = 14.sp,
                                            color = Color.Black,
                                            letterSpacing = 0.5.sp
                                        )
                                        Text(
                                            "Point camera at computer screen • 1s Instant Link",
                                            fontSize = 10.sp,
                                            color = Color.Black.copy(alpha = 0.75f),
                                            fontWeight = FontWeight.SemiBold
                                        )
                                    }
                                }
                            }

                            // SECONDARY: 1-TAP AUTO-LINK TO CLOUD DASHBOARD
                            OutlinedButton(
                                onClick = { autoPairToServer("https://aurafind-security.onrender.com") },
                                enabled = !isPairingLoading,
                                shape = RoundedCornerShape(16.dp),
                                colors = ButtonDefaults.outlinedButtonColors(
                                    contentColor = Color(0xFF10B981)
                                ),
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(48.dp)
                                    .border(1.dp, Color(0xFF10B981).copy(alpha = 0.6f), RoundedCornerShape(16.dp))
                            ) {
                                if (isPairingLoading) {
                                    CircularProgressIndicator(
                                        modifier = Modifier.size(20.dp),
                                        color = Color(0xFF10B981),
                                        strokeWidth = 2.dp
                                    )
                                    Spacer(modifier = Modifier.width(10.dp))
                                    Text("CONNECTING TO AURAFIND CLOUD...", fontSize = 11.sp, fontWeight = FontWeight.Bold)
                                } else {
                                    Text("⚡", fontSize = 18.sp)
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Text(
                                        "⚡ 1-TAP AUTO-LINK CLOUD DASHBOARD",
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.Black,
                                        letterSpacing = 0.5.sp
                                    )
                                }
                            }
                        }
                    }

                    // 2.5. 24/7 BACKGROUND KEEP-ALIVE (BATTERY OPTIMIZATION EXEMPTION)
                    item {
                        val pm = remember { context.getSystemService(Context.POWER_SERVICE) as? android.os.PowerManager }
                        val isBatteryIgnored = remember {
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                                pm?.isIgnoringBatteryOptimizations(context.packageName) == true
                            } else true
                        }

                        if (!isBatteryIgnored && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                            Card(
                                colors = CardDefaults.cardColors(containerColor = Color(0xFF1E1708)),
                                shape = RoundedCornerShape(16.dp),
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .border(1.dp, Color(0xFFF59E0B).copy(alpha = 0.6f), RoundedCornerShape(16.dp))
                                    .clickable {
                                        try {
                                            val intent = Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                                                data = Uri.parse("package:${context.packageName}")
                                            }
                                            context.startActivity(intent)
                                        } catch (e: Exception) {
                                            try {
                                                val intent = Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                                                context.startActivity(intent)
                                            } catch (_: Exception) {}
                                        }
                                    }
                            ) {
                                Row(
                                    modifier = Modifier.padding(14.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text("⚡", fontSize = 24.sp)
                                    Spacer(modifier = Modifier.width(12.dp))
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(
                                            "KEEP ONLINE 24/7 (ACTION REQUIRED)",
                                            color = Color(0xFFF59E0B),
                                            fontWeight = FontWeight.Black,
                                            fontSize = 12.sp,
                                            letterSpacing = 0.5.sp
                                        )
                                        Text(
                                            "Tap to exempt AuraFind from Android Doze sleep mode so it stays online 24/7 when locked.",
                                            color = Color(0xFFCBD5E1),
                                            fontSize = 11.sp,
                                            lineHeight = 15.sp
                                        )
                                    }
                                    Text("➔", color = Color(0xFFF59E0B), fontSize = 16.sp, fontWeight = FontWeight.Bold)
                                }
                            }
                        } else {
                            Card(
                                colors = CardDefaults.cardColors(containerColor = Color(0xFF06281E)),
                                shape = RoundedCornerShape(16.dp),
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .border(1.dp, Color(0xFF10B981).copy(alpha = 0.4f), RoundedCornerShape(16.dp))
                            ) {
                                Row(
                                    modifier = Modifier.padding(12.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text("🛡️", fontSize = 20.sp)
                                    Spacer(modifier = Modifier.width(10.dp))
                                    Column {
                                        Text(
                                            "24/7 BACKGROUND PROTECTION ACTIVE",
                                            color = Color(0xFF10B981),
                                            fontWeight = FontWeight.Bold,
                                            fontSize = 11.sp
                                        )
                                        Text(
                                            "Battery saver exempted. Handset stays online continuously.",
                                            color = Color(0xFF94A3B8),
                                            fontSize = 10.sp
                                        )
                                    }
                                }
                            }
                        }
                    }

                    // 3. Cyber Diagnostic Grid (GPS, Network, Battery, Stealth)
                    item {
                        Card(
                            colors = CardDefaults.cardColors(containerColor = Color(0xFF0F172A)),
                            shape = RoundedCornerShape(20.dp),
                            modifier = Modifier
                                .fillMaxWidth()
                                .border(1.dp, Color(0xFF1E293B), RoundedCornerShape(20.dp))
                        ) {
                            Column(modifier = Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                                Text(
                                    "LIVE TELEMETRY COCKPIT",
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Black,
                                    color = Color(0xFF64748B),
                                    letterSpacing = 1.sp
                                )

                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    // GPS
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text("🛰️ SATELLITE GPS", fontSize = 9.sp, fontWeight = FontWeight.Bold, color = Color(0xFF64748B))
                                        Text(if (isGpsEnabled) "HIGH ACCURACY" else "STANDBY", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = if (isGpsEnabled) Color(0xFF10B981) else Color(0xFFF59E0B))
                                    }
                                    // Network
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text("📶 NETWORK", fontSize = 9.sp, fontWeight = FontWeight.Bold, color = Color(0xFF64748B))
                                        Text(networkType, fontSize = 12.sp, fontWeight = FontWeight.Bold, color = Color.White)
                                    }
                                    // SIM
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text("💳 SIM STATUS", fontSize = 9.sp, fontWeight = FontWeight.Bold, color = Color(0xFF64748B))
                                        Text(if (isSimPresent) "SECURED" else "ABSENT", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = if (isSimPresent) Color(0xFF38BDF8) else Color(0xFFEF4444))
                                    }
                                }

                                Divider(color = Color(0xFF1E293B))

                                // Stealth Mode & Notification Status
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Column {
                                        Text("🔕 STEALTH SERVICE", fontSize = 10.sp, fontWeight = FontWeight.Bold, color = Color(0xFF64748B))
                                        Text("Silent Background Running (0 Popups)", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Color(0xFF10B981))
                                    }
                                    Surface(
                                        color = Color(0xFF10B981).copy(alpha = 0.15f),
                                        shape = RoundedCornerShape(8.dp)
                                    ) {
                                        Text(
                                            "MINIMIZED",
                                            color = Color(0xFF10B981),
                                            fontSize = 10.sp,
                                            fontWeight = FontWeight.Bold,
                                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                                        )
                                    }
                                }
                            }
                        }
                    }

                    // 4. Emergency Tools & Audio Check
                    item {
                        Card(
                            colors = CardDefaults.cardColors(containerColor = Color(0xFF0F172A)),
                            shape = RoundedCornerShape(20.dp),
                            modifier = Modifier
                                .fillMaxWidth()
                                .border(1.dp, Color(0xFF1E293B), RoundedCornerShape(20.dp))
                        ) {
                            Column(modifier = Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                Text(
                                    "🚨 TACTICAL TOOLS",
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Black,
                                    color = Color(0xFF64748B),
                                    letterSpacing = 1.sp
                                )

                                Button(
                                    onClick = { AudioAlarmManager.playAlarm(context, 5) },
                                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFF59E0B).copy(alpha = 0.15f)),
                                    shape = RoundedCornerShape(12.dp),
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .border(1.dp, Color(0xFFF59E0B).copy(alpha = 0.5f), RoundedCornerShape(12.dp))
                                ) {
                                    Text("🚨", fontSize = 18.sp)
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Text("Test Anti-Theft Siren (5s Audio Alarm)", color = Color(0xFFF59E0B), fontWeight = FontWeight.Bold, fontSize = 12.sp)
                                }
                            }
                        }
                    }

                }
            } else {
                SecurityPrivacyScreen()
            }
        }
    }

    // Pair Success Dialog
    if (showPairSuccessDialog) {
        AlertDialog(
            onDismissRequest = { showPairSuccessDialog = false },
            containerColor = Color(0xFF0F172A),
            icon = {
                Icon(
                    imageVector = Icons.Default.CheckCircle,
                    contentDescription = "Success",
                    tint = Color(0xFF10B981),
                    modifier = Modifier.size(48.dp)
                )
            },
            title = {
                Text(
                    "DEVICE LINKED SUCCESSFULLY",
                    color = Color.White,
                    fontWeight = FontWeight.Black,
                    fontSize = 16.sp,
                    textAlign = TextAlign.Center
                )
            },
            text = {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        "This handset is now connected to AuraFind Dashboard. Real-time telemetry, HD cameras, screen mirror, and GPS tracking are active.",
                        color = Color(0xFF94A3B8),
                        fontSize = 12.sp,
                        textAlign = TextAlign.Center
                    )
                    Surface(
                        color = Color(0xFF1E293B),
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(
                            "Server: $savedServerUrl\nID: $savedDeviceId",
                            fontFamily = FontFamily.Monospace,
                            fontSize = 10.sp,
                            color = Color(0xFF00F2FE),
                            modifier = Modifier.padding(10.dp)
                        )
                    }
                }
            },
            confirmButton = {
                Button(
                    onClick = { showPairSuccessDialog = false },
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF10B981)),
                    shape = RoundedCornerShape(10.dp)
                ) {
                    Text("DONE", fontWeight = FontWeight.Bold, color = Color.Black)
                }
            }
        )
    }

    // Manual Server & Configuration Dialog
    if (showConfigDialog) {
        var inputUrl by remember { mutableStateOf(savedServerUrl) }
        var inputUser by remember { mutableStateOf("admin") }
        var inputPass by remember { mutableStateOf("admin") }

        AlertDialog(
            onDismissRequest = { showConfigDialog = false },
            containerColor = Color(0xFF0F172A),
            title = {
                Text("⚙️ Server & Credentials", color = Color.White, fontWeight = FontWeight.Bold)
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Configure backend endpoint URL:", color = Color(0xFF94A3B8), fontSize = 11.sp)
                    OutlinedTextField(
                        value = inputUrl,
                        onValueChange = { inputUrl = it },
                        label = { Text("Server URL", fontSize = 11.sp) },
                        singleLine = true,
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = Color.White,
                            unfocusedTextColor = Color.White,
                            focusedBorderColor = Color(0xFF00F2FE),
                            unfocusedBorderColor = Color(0xFF334155)
                        ),
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = inputUser,
                        onValueChange = { inputUser = it },
                        label = { Text("Account ID", fontSize = 11.sp) },
                        singleLine = true,
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = Color.White,
                            unfocusedTextColor = Color.White,
                            focusedBorderColor = Color(0xFF00F2FE),
                            unfocusedBorderColor = Color(0xFF334155)
                        ),
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = inputPass,
                        onValueChange = { inputPass = it },
                        label = { Text("Password", fontSize = 11.sp) },
                        singleLine = true,
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = Color.White,
                            unfocusedTextColor = Color.White,
                            focusedBorderColor = Color(0xFF00F2FE),
                            unfocusedBorderColor = Color(0xFF334155)
                        ),
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        prefs.edit()
                            .putString("server_url", inputUrl.trim())
                            .putString("username", inputUser.trim())
                            .putString("password", inputPass.trim())
                            .apply()
                        savedServerUrl = inputUrl.trim()
                        NetworkUtils.setServerUrl(inputUrl.trim())
                        showConfigDialog = false
                        autoPairToServer(inputUrl.trim())
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0284C7))
                ) {
                    Text("Save & Connect")
                }
            },
            dismissButton = {
                TextButton(onClick = { showConfigDialog = false }) {
                    Text("Cancel", color = Color(0xFF94A3B8))
                }
            }
        )
    }
}
