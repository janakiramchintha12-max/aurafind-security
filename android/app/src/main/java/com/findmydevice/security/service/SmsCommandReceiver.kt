package com.findmydevice.security.service

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.telephony.SmsManager
import com.findmydevice.security.util.AudioAlarmManager
import com.google.android.gms.location.LocationServices

class SmsCommandReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Telephony.Sms.Intents.SMS_RECEIVED_ACTION) {
            val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
            for (sms in messages) {
                val sender = sms.originatingAddress ?: continue
                val body = sms.messageBody?.trim()?.uppercase() ?: continue

                if (body.contains("#AURAFIND")) {
                    handleEmergencySmsCommand(context, sender, body)
                }
            }
        }
    }

    private fun handleEmergencySmsCommand(context: Context, senderPhone: String, messageText: String) {
        val smsManager: SmsManager = context.getSystemService(SmsManager::class.java)

        when {
            messageText.contains("LOCATE") -> {
                val fusedLocationClient = LocationServices.getFusedLocationProviderClient(context)
                try {
                    fusedLocationClient.lastLocation.addOnSuccessListener { loc ->
                        val replyText = if (loc != null) {
                            "⚠️ AuraFind GPS Alert: Target is at https://maps.google.com/?q=${loc.latitude},${loc.longitude} (Acc: ±${loc.accuracy.toInt()}m)"
                        } else {
                            "⚠️ AuraFind Alert: GPS fix requested. Please retry in 30 seconds."
                        }
                        smsManager.sendTextMessage(senderPhone, null, replyText, null, null)
                    }
                } catch (e: SecurityException) {
                    smsManager.sendTextMessage(senderPhone, null, "AuraFind Alert: GPS permission required.", null, null)
                }
            }

            messageText.contains("ALARM") || messageText.contains("RING") -> {
                AudioAlarmManager.playAlarm(context, 120)
                smsManager.sendTextMessage(senderPhone, null, "⚠️ AuraFind Emergency Alarm activated at MAX volume.", null, null)
            }

            messageText.contains("LOST") -> {
                val serviceIntent = Intent(context, LocationService::class.java).apply {
                    putExtra("MODE", "HIGH_ACCURACY")
                }
                context.startService(serviceIntent)
                AudioAlarmManager.speakText(context, "This phone is reported stolen. Call police immediately.")
                smsManager.sendTextMessage(senderPhone, null, "⚠️ AuraFind Lost Mode & Voice Alert triggered.", null, null)
            }
        }
    }
}
