package com.findmydevice.security

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import com.findmydevice.security.service.LocationService
import com.findmydevice.security.ui.screens.MainScreen

class MainActivity : ComponentActivity() {

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        startLocationService()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Dynamic multi-device credential provisioning
        val isRealme = Build.MODEL.contains("RMX", ignoreCase = true) || Build.MANUFACTURER.contains("realme", ignoreCase = true)
        val targetDeviceId = if (isRealme) "19de15a1-d3fe-4ed2-9bb3-b4b5821bba3c" else "bdca7649-e699-4d57-a59a-e80a4db9e1de"
        val targetDeviceToken = if (isRealme) "d4d93059-eb8a-4c24-afb7-4ad5770cf798" else "ca65a717-1185-417b-b8fc-32289812d8eb"

        val prefs = getSharedPreferences("aurafind_prefs", Context.MODE_PRIVATE)
        prefs.edit()
            .putString("device_id", targetDeviceId)
            .putString("device_token", targetDeviceToken)
            .apply()

        checkAndRequestPermissions()
        checkOverlayPermission()

        setContent {
            MainScreen()
        }
    }

    private fun checkOverlayPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (!Settings.canDrawOverlays(this)) {
                val intent = Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:$packageName")
                )
                startActivity(intent)
            }
        }
    }

    private fun checkAndRequestPermissions() {
        val permissionsToRequest = mutableListOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
            Manifest.permission.READ_PHONE_STATE,
            Manifest.permission.CAMERA,
            Manifest.permission.RECORD_AUDIO
        )

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            permissionsToRequest.add(Manifest.permission.READ_PHONE_NUMBERS)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissionsToRequest.add(Manifest.permission.POST_NOTIFICATIONS)
        }

        val missing = permissionsToRequest.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }

        if (missing.isNotEmpty()) {
            permissionLauncher.launch(missing.toTypedArray())
        } else {
            startLocationService()
        }
    }

    private fun startLocationService() {
        val serviceIntent = Intent(this, LocationService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent)
        } else {
            startService(serviceIntent)
        }
    }
}
