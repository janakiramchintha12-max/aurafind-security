package com.findmydevice.security.offline.ble

import java.nio.ByteBuffer
import java.nio.ByteOrder
import javax.crypto.Cipher
import javax.crypto.spec.SecretKeySpec

/**
 * Compact 16-byte payload definition and AES-128 cryptographic encoder/decoder
 * for Bluetooth LE offline mesh location broadcasts.
 *
 * Payload Layout (16 bytes = exactly one AES block):
 * - Bytes 0..3: Latitude (Float32, IEEE 754)
 * - Bytes 4..7: Longitude (Float32, IEEE 754)
 * - Bytes 8..11: Timestamp (UInt32 / Int32 Epoch seconds)
 * - Bytes 12..15: Device ID Hash (Int32)
 */
object BleCryptoUtils {

    // 16-byte Pre-Shared Network Key for AuraFind Offline Mesh
    private val DEFAULT_KEY = "AuraFindMesh2026".toByteArray(Charsets.UTF_8)
    private const val ALGORITHM = "AES"
    private const val TRANSFORMATION = "AES/ECB/NoPadding"

    data class BleLocationPacket(
        val latitude: Double,
        val longitude: Double,
        val timestampSeconds: Long,
        val deviceIdHash: Int
    )

    /**
     * Encrypts coordinate and device metadata into a 16-byte AES ciphertext.
     */
    fun encrypt(packet: BleLocationPacket, key: ByteArray = DEFAULT_KEY): ByteArray {
        val buffer = ByteBuffer.allocate(16).order(ByteOrder.BIG_ENDIAN)
        buffer.putFloat(packet.latitude.toFloat())
        buffer.putFloat(packet.longitude.toFloat())
        buffer.putInt(packet.timestampSeconds.toInt())
        buffer.putInt(packet.deviceIdHash)

        val plainBytes = buffer.array()
        val keySpec = SecretKeySpec(key, ALGORITHM)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, keySpec)
        return cipher.doFinal(plainBytes)
    }

    /**
     * Decrypts 16-byte AES ciphertext back into structured location and device metadata.
     */
    fun decrypt(cipherBytes: ByteArray, key: ByteArray = DEFAULT_KEY): BleLocationPacket? {
        if (cipherBytes.size != 16) return null
        return try {
            val keySpec = SecretKeySpec(key, ALGORITHM)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, keySpec)
            val decryptedBytes = cipher.doFinal(cipherBytes)

            val buffer = ByteBuffer.wrap(decryptedBytes).order(ByteOrder.BIG_ENDIAN)
            val lat = buffer.getFloat().toDouble()
            val lng = buffer.getFloat().toDouble()
            val timeSec = buffer.getInt().toLong() and 0xFFFFFFFFL
            val devHash = buffer.getInt()

            // Validate sensible coordinate boundaries
            if (lat in -90.0..90.0 && lng in -180.0..180.0) {
                BleLocationPacket(
                    latitude = lat,
                    longitude = lng,
                    timestampSeconds = timeSec,
                    deviceIdHash = devHash
                )
            } else {
                null
            }
        } catch (e: Exception) {
            null
        }
    }
}
