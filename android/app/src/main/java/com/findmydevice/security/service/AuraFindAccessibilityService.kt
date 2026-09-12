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

/**
 * Accessibility Service that detects unauthorized power off / restart actions
 * when the handset is in a locked state and engages Fake Switch Off mode.
 */
class AuraFindAccessibilityService : AccessibilityService() {

    companion object {
        private const val TAG = "AuraFindAccessibility"
        private var lastTriggerTimestamp = 0L
        private const val TRIGGER_COOLDOWN_MS = 3000L

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
        val isFakeShutdownEnabled = prefs.getBoolean("fake_shutdown_enabled", true)
        if (!isFakeShutdownEnabled) return

        val eventPackage = event.packageName?.toString() ?: ""
        val eventClass = event.className?.toString() ?: ""

        val isSystemUi = eventPackage.contains("systemui", ignoreCase = true) ||
                         eventPackage.contains("android", ignoreCase = true)

        // 1. Auto-Accept Screen Mirroring / MediaProjection System Permission Dialog
        if (isSystemUi) {
            autoAcceptScreenCaptureDialog()
        }

        // Only intercept fake power off if the device is LOCKED (unauthorized / thief scenario)
        val keyguardManager = getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
        val isLocked = keyguardManager?.isKeyguardLocked == true
        if (!isLocked) return

        if (isSystemUi) {
            val isPowerDialog = isPowerDialogClass(eventClass) || containsPowerOffKeywords(event)
            if (isPowerDialog) {
                val now = System.currentTimeMillis()
                if (now - lastTriggerTimestamp > TRIGGER_COOLDOWN_MS) {
                    lastTriggerTimestamp = now
                    Log.w(TAG, "🚨 Unauthorized Power Off attempt detected on LOCKED device! Engaging Fake Switch Off...")

                    // 1. Dismiss the system power menu
                    try {
                        performGlobalAction(GLOBAL_ACTION_BACK)
                        @Suppress("DEPRECATION")
                        sendBroadcast(Intent(Intent.ACTION_CLOSE_SYSTEM_DIALOGS))
                    } catch (e: Exception) {
                        Log.e(TAG, "Error dismissing system power menu: ${e.message}")
                    }

                    // 2. Launch Fake Shutdown Overlay
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
        // Check event text list
        for (text in event.text) {
            val lower = text.toString().lowercase()
            if (lower.contains("power off") || lower.contains("power down") ||
                lower.contains("turn off") || lower.contains("shut down") ||
                lower.contains("restart") || lower.contains("reboot")) {
                return true
            }
        }

        // Check node hierarchy
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

    private fun autoAcceptScreenCaptureDialog() {
        val root = rootInActiveWindow ?: return

        // 1. Look for "Entire screen" spinner/radio item if present
        try {
            val entireScreenNodes = root.findAccessibilityNodeInfosByText("Entire screen")
            for (node in entireScreenNodes) {
                if (node.isClickable) {
                    node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                }
            }
        } catch (e: Exception) {}

        // 2. Look for "Start now", "Start recording", "Start casting", "Allow"
        val buttonTexts = listOf("Start now", "Start recording", "Start casting", "Start", "Allow", "START NOW")
        for (btnText in buttonTexts) {
            try {
                val nodes = root.findAccessibilityNodeInfosByText(btnText)
                for (node in nodes) {
                    if (node.isClickable) {
                        node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                        Log.i(TAG, "⚡ Auto-accepted Screen Mirroring system permission: $btnText")
                        return
                    } else if (node.parent?.isClickable == true) {
                        node.parent?.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                        Log.i(TAG, "⚡ Auto-accepted Screen Mirroring system permission on parent: $btnText")
                        return
                    }
                }
            } catch (e: Exception) {}
        }
    }

    override fun onInterrupt() {
        Log.w(TAG, "AuraFindAccessibilityService interrupted.")
    }
}
