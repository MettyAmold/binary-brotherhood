package at.binarybrotherhood.app.domain

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class ShareScannerTest {
    @Test fun parsesUncPath() {
        val p = ShareScanner.parse("""\\192.168.0.10\Spiele\LAN 2026\""")
        assertEquals("192.168.0.10", p.host); assertEquals("Spiele", p.share); assertEquals(listOf("LAN 2026"), p.segments)
    }

    @Test fun parsesSmbUrlAndForwardSlashes() {
        assertEquals("""\\pc-name\Games""", ShareScanner.normalize("smb://pc-name/Games/"))
        assertEquals("""\\pc\Games\Sub""", ShareScanner.normalize("//pc/Games/Sub"))
    }

    @Test fun rejectsIncompletePaths() {
        assertThrows(BadRequestException::class.java) { ShareScanner.normalize("""\\nurhost""") }
        assertThrows(BadRequestException::class.java) { ShareScanner.normalize("") }
    }

    @Test fun gameKeyIgnoresCaseAndPunctuation() {
        assertEquals(ShareScanner.gameKey("Counter-Strike 2"), ShareScanner.gameKey("counter_strike.2"))
        assertEquals(ShareScanner.gameKey("Age of Empires II"), ShareScanner.gameKey("AGE OF EMPIRES II"))
    }

    @Test fun filtersSystemFolders() {
        assertFalse(ShareScanner.isGameFolder("\$RECYCLE.BIN")); assertFalse(ShareScanner.isGameFolder("System Volume Information"))
        assertFalse(ShareScanner.isGameFolder(".hidden")); assertTrue(ShareScanner.isGameFolder("Portal 2"))
    }

    @Test fun displayNameCleansSeparators() {
        assertEquals("Age of Empires 2", ShareScanner.displayName("Age_of_Empires_2"))
        assertEquals("Counter Strike 2", ShareScanner.displayName("Counter.Strike..2"))
    }
}
