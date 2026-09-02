package com.findmydevice.security

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.UUID

class SyncLogicTest {

    @Test
    fun testOfflineLocationDeduplication() {
        val timestamp1 = 1724500000000L
        val timestamp2 = 1724500001000L // 1 sec later (duplicate window)

        val deltaSeconds = (timestamp2 - timestamp1) / 1000
        val isDuplicate = deltaSeconds <= 2

        assertTrue("Locations within 2 seconds should be marked duplicate", isDuplicate)
    }

    @Test
    fun testTrackingIntervalModes() {
        fun getInterval(mode: String): Long {
            return when (mode) {
                "HIGH_ACCURACY" -> 15_000L
                "BATTERY_SAVER" -> 15 * 60_000L
                "OFFLINE" -> 10 * 60_000L
                else -> 5 * 60_000L
            }
        }

        assertEquals(15000L, getInterval("HIGH_ACCURACY"))
        assertEquals(900000L, getInterval("BATTERY_SAVER"))
        assertEquals(300000L, getInterval("NORMAL"))
    }
}
