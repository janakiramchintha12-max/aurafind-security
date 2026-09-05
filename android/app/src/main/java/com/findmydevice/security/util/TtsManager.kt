package com.findmydevice.security.util

import android.content.Context
import android.media.AudioManager
import android.speech.tts.TextToSpeech
import java.util.Locale

/**
 * High-volume Text-to-Speech Broadcaster for AuraFind
 */
object TtsManager {

    private var tts: TextToSpeech? = null
    private var isInitialized = false
    private var pendingText: String? = null

    fun init(context: Context) {
        if (tts == null) {
            tts = TextToSpeech(context.applicationContext) { status ->
                if (status == TextToSpeech.SUCCESS) {
                    tts?.language = Locale.US
                    tts?.setSpeechRate(0.95f)
                    tts?.setPitch(1.0f)
                    isInitialized = true
                    pendingText?.let {
                        speak(context, it)
                        pendingText = null
                    }
                }
            }
        }
    }

    fun speak(context: Context, text: String) {
        if (text.isBlank()) return

        // Maximize media volume so the voice broadcast is loud and clear
        try {
            val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            val maxVol = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
            audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, maxVol, 0)
        } catch (e: Exception) {
            e.printStackTrace()
        }

        if (isInitialized && tts != null) {
            tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "AuraFindTTS_" + System.currentTimeMillis())
        } else {
            pendingText = text
            init(context)
        }
    }

    fun shutdown() {
        tts?.stop()
        tts?.shutdown()
        tts = null
        isInitialized = false
    }
}
