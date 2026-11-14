package net.ayin.shell

import org.junit.Assert.*
import org.junit.Test

class VideoSourcePolicyTest {
    @Test fun onlyContentDocumentsCanBeRetained() {
        assertTrue(VideoSourcePolicy.contentUri("content://documents.example/video/123"))
        for (raw in listOf("file:///private/video.mp4", "https://ayin.stream/video.mp4", "content:///empty", "content://user@provider/video", "content://provider/video#fragment", "not a URI")) {
            assertFalse(raw, VideoSourcePolicy.contentUri(raw))
        }
    }

    @Test fun sourceLeaseExpiresAndRejectsClockRollback() {
        val now = 2_000_000_000_000L
        assertTrue(VideoSourcePolicy.fresh(now, now))
        assertTrue(VideoSourcePolicy.fresh(now - 7L * 24 * 60 * 60 * 1000, now))
        assertFalse(VideoSourcePolicy.fresh(now - 8L * 24 * 60 * 60 * 1000, now))
        assertFalse(VideoSourcePolicy.fresh(now + 1, now))
        assertFalse(VideoSourcePolicy.fresh(0, now))
    }

    @Test fun shareSheetOnlyReceivesPublicFirstPartyDestinations() {
        for (url in listOf("https://ayin.stream/watch/a-video", "https://ayin.stream/ar/c/mr-lord", "https://ayin.stream:443/clips", "https://ayin.stream/live/a-stream?kids=1", "https://ayin.stream/playlists/a-playlist?lang=ar&kids=1", "https://ayin.stream/en/watch/a-video?kids=1&lang=en")) {
            assertTrue(url, VideoSourcePolicy.publicShareUrl(url))
        }
        for (url in listOf("https://evil.example/watch/a-video", "https://ayin.stream@evil.example/watch/a", "http://ayin.stream/watch/a", "https://ayin.stream:444/watch/a", "https://ayin.stream/admin", "https://ayin.stream/account", "https://ayin.stream/watch/a?token=secret", "https://ayin.stream/watch/a#secret", "https://ayin.stream/auth/callback", "https://user@ayin.stream/watch/a", "https://ayin.stream/watch/a?kids=0", "https://ayin.stream/watch/a?kids=1&kids=1", "https://ayin.stream/watch/a?lang=ar&lang=en", "https://ayin.stream/watch/a?k%69ds=1", "https://ayin.stream/watch/a?kids=1&lang=en&token=secret", "https://ayin.stream/watch/..", "https://ayin.stream/clips/a-video", "https://ayin.stream/channel/a", "https://ayin.stream/watch/a?")) {
            assertFalse(url, VideoSourcePolicy.publicShareUrl(url))
        }
    }
}
