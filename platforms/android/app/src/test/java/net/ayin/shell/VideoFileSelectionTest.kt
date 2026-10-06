package net.ayin.shell

import org.junit.Assert.*
import org.junit.Test

class VideoFileSelectionTest {
    @Test
    fun uploadAcceptListSelectsOnlyVideos() {
        assertEquals(listOf("video/*"), VideoFileSelection.acceptedTypes(arrayOf("video/*,.mp4,.mov")))
        assertEquals(listOf("video/mp4"), VideoFileSelection.acceptedTypes(arrayOf("video/mp4,.mp4")))
        assertTrue(VideoFileSelection.acceptedTypes(arrayOf("image/jpeg,.csv,*/*")).isEmpty())
        assertFalse(VideoFileSelection.accepts("image/jpeg", listOf("video/*")))
        assertFalse(VideoFileSelection.accepts(null, listOf("video/*")))
        assertFalse(VideoFileSelection.accepts("video/webm", listOf("video/mp4")))
        assertTrue(VideoFileSelection.accepts("video/mp4", listOf("video/mp4")))
    }

    @Test
    fun cancelledNavigationCannotDeliverOldResultToNewCallback() {
        val lease = FileSelectionLease<String>()
        assertTrue(lease.begin("document A"))
        assertEquals("document A", lease.cancel())
        assertNull(lease.cancel())
        assertFalse(lease.begin("document B"))
        assertNull(lease.receiveResult())
        assertTrue(lease.begin("document B"))
        val current = lease.receiveResult()!!
        assertEquals("document B", lease.completeValidation(current))
        assertNull(lease.completeValidation(current))
    }

    @Test
    fun repeatedRequestsKeepOneOwnedCallbackAndLaunchFailureReleasesIt() {
        val lease = FileSelectionLease<String>()
        assertTrue(lease.begin("first"))
        assertFalse(lease.begin("second"))
        assertEquals("first", lease.launchFailed())
        assertTrue(lease.begin("after launch failure"))
    }

    @Test
    fun cancelledProviderValidationCannotDeliverOrReleaseNewSelection() {
        val lease = FileSelectionLease<Any>()
        val old = Any()
        val replacement = Any()
        assertTrue(lease.begin(old))
        assertSame(old, lease.receiveResult())
        assertFalse(lease.begin(replacement))
        assertSame(old, lease.cancel())
        assertNull(lease.cancel())
        assertTrue(lease.begin(replacement))
        assertNull(lease.completeValidation(old))
        assertSame(replacement, lease.receiveResult())
        assertNull(lease.completeValidation(old))
        assertSame(replacement, lease.completeValidation(replacement))
        assertNull(lease.completeValidation(replacement))
    }
}
