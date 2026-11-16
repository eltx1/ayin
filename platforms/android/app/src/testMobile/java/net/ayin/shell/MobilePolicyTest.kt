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
    @Test fun acceptsMixedNativeInventoryWithoutChangingSchema() {
        val data = fixture()
        val platforms = data.getJSONObject("ads").getJSONObject("platforms")
        platforms.getJSONObject("android").put("bannerUnitId", "/123456/ayin/browse-bottom")
            .put("interstitialUnitId", "ca-app-pub-1234567890123456/1234567890")
        platforms.getJSONObject("ios").put("bannerUnitId", "/123456/ayin_ios.v1/banner")
        val result = MobileConfig.parse(data)
        assertEquals("/123456/ayin/browse-bottom", result.bannerUnitId)
        assertFalse(MobileAdInventory.isAdManager(result.interstitialUnitId))
        assertTrue(MobileAdInventory.isAdManager(result.bannerUnitId))
    }
    @Test fun rejectsMalformedOrUnboundedGamUnitsOnBothPlatforms() {
        for (platform in listOf("android", "ios")) {
            for (unit in listOf("/network/banner", "/123", "/123/", "/123//banner", "/123/banner?x=1",
                "/123/banner#x", "https://example.com/tag", "/123/banner name", "/123/%2F", "/123/banner\n",
                "/123456789012345678901/banner", "/123/" + "a".repeat(252))) {
                val data = fixture()
                data.getJSONObject("ads").getJSONObject("platforms").getJSONObject(platform).put("bannerUnitId", unit)
                assertThrows(IllegalArgumentException::class.java) { MobileConfig.parse(data) }
            }
        }
        assertTrue(MobileAdInventory.isValid("/123/" + "a".repeat(251)))
    }
    @Test fun debugAndTestModeNeverRequestConfiguredProductionInventory() {
        val gam = "/123456/ayin/banner"
        val admob = "ca-app-pub-1234567890123456/1234567890"
        for ((debug, testMode) in listOf(true to false, false to true, true to true)) {
            assertEquals("/21775744923/example/adaptive-banner", MobileAdInventory.resolve(gam, "banner", debug, testMode))
            assertEquals("/21775744923/example/interstitial", MobileAdInventory.resolve(gam, "interstitial", debug, testMode))
            assertEquals("ca-app-pub-3940256099942544/6300978111", MobileAdInventory.resolve(admob, "banner", debug, testMode))
            assertEquals("ca-app-pub-3940256099942544/1033173712", MobileAdInventory.resolve(admob, "interstitial", debug, testMode))
        }
        assertEquals(gam, MobileAdInventory.resolve(gam, "banner", false, false))
        assertEquals(admob, MobileAdInventory.resolve(admob, "interstitial", false, false))
        assertEquals("", MobileAdInventory.resolve("", "banner", false, false))
        assertThrows(IllegalArgumentException::class.java) { MobileAdInventory.resolve("/invalid", "banner", true, true) }
        assertThrows(IllegalArgumentException::class.java) { MobileAdInventory.resolve(gam, "rewarded", true, true) }
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
