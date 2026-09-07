package com.findmydevice.security.util

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale

/**
 * High-Volume Loudspeaker Text-to-Speech Broadcaster for AuraFind Security Platform
 * Overrides silent / vibrate / DND mode and broadcasts over the physical loudspeaker at 100% volume.
 */
object TtsManager {

    private var tts: TextToSpeech? = null
    private var isInitialized = false
    private var pendingText: String? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    fun init(context: Context, onReady: (() -> Unit)? = null) {
        if (tts == null) {
            tts = TextToSpeech(context.applicationContext) { status ->
                if (status == TextToSpeech.SUCCESS) {
                    try {
                        val langResult = tts?.setLanguage(Locale.US)
                        if (langResult == TextToSpeech.LANG_MISSING_DATA || langResult == TextToSpeech.LANG_NOT_SUPPORTED) {
                            tts?.setLanguage(Locale.getDefault())
                        }
                    } catch (e: Exception) {
                        tts?.setLanguage(Locale.getDefault())
                    }

                    // Configure Emergency Alarm AudioAttributes to bypass silent/vibrate modes
                    try {
                        val audioAttributes = AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ALARM)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .setFlags(AudioAttributes.FLAG_AUDIBILITY_ENFORCED)
                            .build()
                        tts?.setAudioAttributes(audioAttributes)
                    } catch (e: Exception) {
                        e.printStackTrace()
                    }

                    tts?.setSpeechRate(0.92f)
                    tts?.setPitch(1.05f)
                    isInitialized = true

                    onReady?.invoke()

                    pendingText?.let { text ->
                        speak(context, text)
                        pendingText = null
                    }
                }
            }
        } else if (isInitialized) {
            onReady?.invoke()
        }
    }

    /**
     * Maximize all audio streams on the device to guarantee maximum hardware loudness.
     */
    private fun maximizeDeviceVolume(context: Context) {
        try {
            val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            
            // Force speakerphone mode for highest acoustic output
            try {
                audioManager.mode = AudioManager.MODE_NORMAL
                audioManager.isSpeakerphoneOn = true
            } catch (e: Exception) {}

            val streams = intArrayOf(
                AudioManager.STREAM_ALARM,
                AudioManager.STREAM_MUSIC,
                AudioManager.STREAM_RING,
                AudioManager.STREAM_NOTIFICATION,
                AudioManager.STREAM_SYSTEM,
                AudioManager.STREAM_VOICE_CALL
            )

            for (stream in streams) {
                try {
                    val maxVol = audioManager.getStreamMaxVolume(stream)
                    audioManager.setStreamVolume(stream, maxVol, AudioManager.FLAG_REMOVE_SOUND_AND_VIBRATE)
                } catch (e: Exception) {}
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    /**
     * Play a high-pitch wake chime to activate physical loudspeaker amplifiers before speech.
     */
    private fun playWakeChime() {
        try {
            val toneGen = ToneGenerator(AudioManager.STREAM_ALARM, 100)
            toneGen.startTone(ToneGenerator.TONE_PROP_BEEP2, 220)
            mainHandler.postDelayed({
                try {
                    toneGen.release()
                } catch (e: Exception) {}
            }, 300)
        } catch (e: Exception) {
            // Non-fatal if ToneGenerator is busy
        }
    }

    fun speak(context: Context, text: String) {
        if (text.isBlank()) return

        // 1. Maximize all volume streams to 100%
        maximizeDeviceVolume(context)

        // 2. Play audible attention chime
        playWakeChime()

        // 3. Ensure TTS engine is ready and speak
        if (isInitialized && tts != null) {
            mainHandler.postDelayed({
                try {
                    maximizeDeviceVolume(context)

                    val utteranceId = "AuraFindMegaphone_${System.currentTimeMillis()}"
                    val params = Bundle().apply {
                        putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, AudioManager.STREAM_ALARM)
                        putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 1.0f)
                        putString(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, utteranceId)
                    }

                    tts?.speak(text, TextToSpeech.QUEUE_FLUSH, params, utteranceId)
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }, 250)
        } else {
            pendingText = text
            init(context) {
                // Will speak pending text upon initialization
            }
        }
    }

    fun shutdown() {
        try {
            tts?.stop()
            tts?.shutdown()
        } catch (e: Exception) {}
        tts = null
        isInitialized = false
    }
}
