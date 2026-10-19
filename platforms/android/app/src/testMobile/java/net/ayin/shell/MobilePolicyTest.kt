package net.ayin.shell

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class MobilePolicyTest {
    private fun fixture() = JSONObject(javaClass.classLoader!!.getResource("mobile-runtime-config.json")!!.readText())

    @Test fun defaultsAreDisabledAndNoInventedInventory() {
        val result = MobileConfig.parse(fixture())
        assertFalse(result.adsEnabled)
        assertFalse(result.analyticsEnabled)
        assertFalse(result.notificationsEnabled)
        assertEquals("", result.bannerUnitId)
    }
    @Test fun rejectsRemoteNativeCodeAndUntrustedOrigin() {
        for ((key, value) in listOf("origin" to "https://attacker.example", "mode" to "bundle", "bundleUpdatesEnabled" to true)) {
            val data = fixture(); data.getJSONObject("web").put(key, value)
            assertThrows(IllegalArgumentException::class.java) { MobileConfig.parse(data) }
        }
    }
    @Test fun rejectsCoercedTypesUnknownFieldsAndUnboundedRetries() {
        for (value in listOf<Any>("1", 1.5, 99, true)) {
            val data = fixture(); data.getJSONObject("ads").put("retryCount", value)
            assertThrows(RuntimeException::class.java) { MobileConfig.parse(data) }
        }
        val data = fixture().put("eval", "alert(1)")
        assertThrows(IllegalArgumentException::class.java) { MobileConfig.parse(data) }
    }
    @Test fun productionInventoryAndAudienceMustBeExplicit() {
        val data = fixture(); val ads = data.getJSONObject("ads")
        ads.put("enabled", true)
        assertThrows(IllegalArgumentException::class.java) { MobileConfig.parse(data) }
        ads.put("audience", "general").put("testMode", false)
        ads.getJSONObject("banner").put("enabled", true)
        ads.getJSONObject("platforms").getJSONObject("android").put("enabled", true)
        assertThrows(IllegalArgumentException::class.java) { MobileConfig.parse(data) }
    }
    @Test fun versionComparisonIsNumericAndRolloutStable() {
        for (invalid in listOf("1.1.0-beta", "10000.1.0", "1.10000.0", "1.0.10000")) {
            val data = fixture()
            data.getJSONObject("latestAppVersion").put("android", invalid)
            assertThrows(IllegalArgumentException::class.java) { MobileConfig.parse(data) }
        }
        assertTrue(MobileConfig.versionAtLeast("1.10.0", "1.2.0"))
        assertFalse(MobileConfig.versionAtLeast("1.1.0", "2.0.0"))
        val id = "123e4567-e89b-42d3-a456-426614174000"
        assertEquals(MobileConfig.rolloutBucket(id), MobileConfig.rolloutBucket(id))
        assertTrue(MobileConfig.rolloutBucket(id) in 0..99)
    }
    @Test fun analyticsRejectsPiiFreeTextAndSdkOwnedEvents() {
        assertTrue(MobileAnalyticsPolicy.validate("search", JSONObject().put("query_length", 5)))
        assertFalse(MobileAnalyticsPolicy.validate("search", JSONObject().put("query_length", 5).put("query", "private")))
        assertFalse(MobileAnalyticsPolicy.validate("ad_impression", JSONObject()))
        assertFalse(MobileAnalyticsPolicy.validate("screen_view", JSONObject().put("screen_name", "person@example.org")))
        assertFalse(MobileAnalyticsPolicy.validate("video_progress", JSONObject().put("content_type", "video").put("position_seconds", -1)))
        assertTrue(MobileAnalyticsPolicy.validate("upload_failed", JSONObject().put("size_bucket", "large")))
    }
}
