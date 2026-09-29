package com.findmydevice.security.service

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.text.TextUtils
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import com.findmydevice.security.ui.FakeShutdownOverlayActivity
import com.findmydevice.security.ui.LostModeOverlayActivity

/**
 * Accessibility Service that enforces:
 * 1. Lost Mode Kiosk Lock (blocks power menu, status bar pull-downs, and unauthorized apps).
 * 2. Fake Switch Off Mode when the device is locked.
 */
class AuraFindAccessibilityService : AccessibilityService() {

    companion object {
        private const val TAG = "AuraFindAccessibility"
        private var lastTriggerTimestamp = 0L
        private const val TRIGGER_COOLDOWN_MS = 1500L

        fun isAccessibilityServiceEnabled(context: Context): Boolean {
            val expectedService = "${context.packageName}/${AuraFindAccessibilityService::class.java.canonicalName}"
            val enabledServices = Settings.Secure.getString(
                context.contentResolver,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            ) ?: return false

            val colonSplitter = TextUtils.SimpleStringSplitter(':')
            colonSplitter.setString(enabledServices)
            while (colonSplitter.hasNext()) {
                val componentName = colonSplitter.next()
                if (componentName.equals(expectedService, ignoreCase = true)) {
                    return true
                }
            }
            return false
        }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return

        val prefs = getSharedPreferences("aurafind_prefs", Context.MODE_PRIVATE)
        val isLostMode = prefs.getBoolean("is_lost_mode", false)
        val isFakeShutdownEnabled = prefs.getBoolean("fake_shutdown_enabled", false)

        val eventPackage = event.packageName?.toString() ?: ""
        val eventClass = event.className?.toString() ?: ""

        // ── 1. STRICT LOST MODE ENFORCEMENT ───────────────────────────────────
        if (isLostMode) {
            val isDialer = eventPackage.contains("dialer", ignoreCase = true) ||
                           eventPackage.contains("telecom", ignoreCase = true) ||
                           eventPackage.contains("incall", ignoreCase = true) ||
                           eventPackage.contains("phone", ignoreCase = true)
            val isOurApp = eventPackage == packageName

            // If system power dialog or power menu appears in lost mode:
            val isPowerDialog = isPowerDialogClass(eventClass) || containsPowerOffKeywords(event)
            if (isPowerDialog) {
                try {
                    performGlobalAction(GLOBAL_ACTION_BACK)
                    @Suppress("DEPRECATION")
                    sendBroadcast(Intent(Intent.ACTION_CLOSE_SYSTEM_DIALOGS))
                } catch (e: Exception) {}

                val lostIntent = Intent(this, LostModeOverlayActivity::class.java).apply {
                    addFlags(
                        Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_CLEAR_TOP or
                        Intent.FLAG_ACTIVITY_SINGLE_TOP or
                        Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
                    )
                }
                startActivity(lostIntent)
                return
            }

            // If notification shade or quick settings is pulled down in lost mode:
            if (eventPackage == "com.android.systemui") {
                val lowerClass = eventClass.lowercase()
                if (lowerClass.contains("shade") || lowerClass.contains("notification") ||
                    lowerClass.contains("quicksettings") || lowerClass.contains("panel") ||
                    lowerClass.contains("expanded")) {
                    try {
                        performGlobalAction(GLOBAL_ACTION_DISMISS_NOTIFICATION_SHADE)
                        performGlobalAction(GLOBAL_ACTION_BACK)
                    } catch (e: Exception) {}
                }
            }

            // If any unauthorized app (not our app, and not the phone dialer) tries to gain foreground:
            if (!isOurApp && !isDialer && event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
                val lostIntent = Intent(this, LostModeOverlayActivity::class.java).apply {
                    addFlags(
                        Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_CLEAR_TOP or
                        Intent.FLAG_ACTIVITY_SINGLE_TOP or
                        Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
                    )
                }
                startActivity(lostIntent)
            }
            return
        }

        // ── 2. FAKE SHUTDOWN ENFORCEMENT ──────────────────────────────────────
        if (!isFakeShutdownEnabled) return

        // STRICT SYSTEM UI CHECK: Only process SystemUI for Fake Shutdown
        val isSystemUi = eventPackage == "com.android.systemui"
        if (!isSystemUi) return

        val keyguardManager = getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
        val isLocked = keyguardManager?.isKeyguardLocked == true
        if (!isLocked) return

        val isPowerDialog = isPowerDialogClass(eventClass) || containsPowerOffKeywords(event)
        if (isPowerDialog) {
            val now = System.currentTimeMillis()
            if (now - lastTriggerTimestamp > TRIGGER_COOLDOWN_MS) {
                lastTriggerTimestamp = now
                Log.w(TAG, "🚨 Unauthorized Power Off attempt detected on LOCKED device! Engaging Fake Switch Off...")

                try {
                    performGlobalAction(GLOBAL_ACTION_BACK)
                    @Suppress("DEPRECATION")
                    sendBroadcast(Intent(Intent.ACTION_CLOSE_SYSTEM_DIALOGS))
                } catch (e: Exception) {
                    Log.e(TAG, "Error dismissing system power menu: ${e.message}")
                }

                val fakeShutdownIntent = Intent(this, FakeShutdownOverlayActivity::class.java).apply {
                    addFlags(
                        Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_CLEAR_TOP or
                        Intent.FLAG_ACTIVITY_SINGLE_TOP
                    )
                }
                startActivity(fakeShutdownIntent)
            }
        }
    }

    private fun isPowerDialogClass(className: String): Boolean {
        val lower = className.lowercase()
        return lower.contains("globalactions") ||
               lower.contains("powerdialog") ||
               lower.contains("shutdown") ||
               lower.contains("reboot") ||
               lower.contains("powermenu")
    }

    private fun containsPowerOffKeywords(event: AccessibilityEvent): Boolean {
        for (text in event.text) {
            val lower = text.toString().lowercase()
            if (lower.contains("power off") || lower.contains("power down") ||
                lower.contains("turn off") || lower.contains("shut down") ||
                lower.contains("restart") || lower.contains("reboot")) {
                return true
            }
        }

        val rootNode = rootInActiveWindow ?: return false
        return inspectNodeForPowerKeywords(rootNode)
    }

    private fun inspectNodeForPowerKeywords(node: AccessibilityNodeInfo?): Boolean {
        if (node == null) return false
        val text = node.text?.toString()?.lowercase() ?: ""
        val contentDesc = node.contentDescription?.toString()?.lowercase() ?: ""

        if (text.contains("power off") || text.contains("turn off") || text.contains("shut down") ||
            contentDesc.contains("power off") || contentDesc.contains("turn off") || contentDesc.contains("shut down")) {
            return true
        }

        for (i in 0 until node.childCount) {
            val child = node.getChild(i)
            if (inspectNodeForPowerKeywords(child)) {
                return true
            }
        }
        return false
    }

    override fun onInterrupt() {
        Log.w(TAG, "AuraFindAccessibilityService interrupted.")
    }
}
