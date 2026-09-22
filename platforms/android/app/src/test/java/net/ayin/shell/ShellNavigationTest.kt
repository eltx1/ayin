package net.ayin.shell

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ShellNavigationTest {
    @Test
    fun normalizesCanonicalAndCustomDeepLinks() {
        assertEquals(
            "https://ayin.stream/watch/example?autoplay=1",
            ShellNavigation.normalizeDeepLink("https://ayin.stream/watch/example?autoplay=1"),
        )
        assertEquals(
            "https://ayin.stream/watch/example?autoplay=1#player",
            ShellNavigation.normalizeDeepLink("ayin://watch/example?autoplay=1#player"),
        )
        assertNull(ShellNavigation.normalizeDeepLink("http://ayin.stream/watch/example"))
        assertNull(ShellNavigation.normalizeDeepLink("https://example.com/watch/example"))
        assertNull(ShellNavigation.normalizeDeepLink("https://ayin.stream:444/watch/example"))
    }

    @Test
    fun parsesGoogleTvDirectBackHintWithoutTreatingOtherValuesAsTrue() {
        assertTrue(
            ShellNavigation.exitOnBackRequested(
                "https://ayin.stream/live/example?exit_on_back=true",
            ),
        )
        assertTrue(
            ShellNavigation.exitOnBackRequested(
                "ayin://live/example?foo=1&exit_on_back=TRUE",
            ),
        )
        assertFalse(
            ShellNavigation.exitOnBackRequested(
                "https://ayin.stream/live/example?exit_on_back=false",
            ),
        )
        assertFalse(ShellNavigation.exitOnBackRequested("ayin://live/example"))
    }

    @Test
    fun identifiesOnlyRemoteFirstShellsAsTv() {
        assertTrue(ShellNavigation.isTvPlatform("google-tv"))
        assertTrue(ShellNavigation.isTvPlatform("android-tv"))
        assertTrue(ShellNavigation.isTvPlatform("fire-tv"))
        assertFalse(ShellNavigation.isTvPlatform("android"))
    }
}
