package net.ayin.shell

import org.json.JSONObject

internal data class MobileConfig(
    val adsEnabled: Boolean = false,
    val testMode: Boolean = true,
    val audience: String = "unknown",
    val bannerEnabled: Boolean = false,
    val interstitialEnabled: Boolean = false,
    val bannerUnitId: String = "",
    val interstitialUnitId: String = "",
    val cooldownSeconds: Int = 180,
    val maxPerSession: Int = 3,
    val requestTimeoutMs: Int = 10000,
    val retryCount: Int = 1,
    val retryBackoffMs: Int = 2000,
    val analyticsEnabled: Boolean = false,
    val notificationsEnabled: Boolean = false,
    val notificationTypes: Set<String> = emptySet(),
    val minimumAppVersion: String = "1.0.0",
    val rolloutPercent: Int = 100,
) {
    companion object {
        private val unit = Regex("ca-app-pub-[0-9]{16}/[0-9]{10}")
        private val types = setOf("system", "channel", "video", "comment", "subscription", "moderation", "monetization")
        private val version = Regex("[0-9]{1,5}\\.[0-9]{1,5}\\.[0-9]{1,5}(?:-[a-zA-Z0-9.-]{1,32})?")
        private fun fields(obj: JSONObject, vararg expected: String) = require(obj.keys().asSequence().toSet() == expected.toSet())
        private fun bool(obj: JSONObject, key: String): Boolean = (obj.get(key) as? Boolean) ?: error("Invalid boolean")
        private fun range(obj: JSONObject, key: String, min: Int, max: Int): Int {
            val raw = obj.get(key) as? Number ?: error("Invalid number")
            val number = raw.toDouble()
            require(number.isFinite() && number % 1.0 == 0.0 && number >= min && number <= max)
            return number.toInt()
        }
        fun versionAtLeast(current: String, minimum: String): Boolean {
            val a = current.substringBefore('-').split('.').map { it.toIntOrNull() ?: 0 }
            val b = minimum.substringBefore('-').split('.').map { it.toIntOrNull() ?: 0 }
            if (a.size != 3 || b.size != 3) return false
            for (i in 0..2) if (a[i] != b[i]) return a[i] > b[i]
            return true
        }
        fun rolloutBucket(installationId: String): Int =
            (java.security.MessageDigest.getInstance("SHA-256").digest(installationId.toByteArray(Charsets.UTF_8)).take(4)
                .fold(0L) { value, byte -> value * 256 + (byte.toInt() and 255) } % 100).toInt()

        fun parse(root: JSONObject): MobileConfig {
            fields(root, "schemaVersion", "bridgeVersion", "minimumAppVersion", "latestAppVersion", "ads", "analytics", "notifications", "web")
            require(range(root, "schemaVersion", 1, 1) == 1 && range(root, "bridgeVersion", 1, 1) == 1)
            val minimum = root.getJSONObject("minimumAppVersion")
            val latest = root.getJSONObject("latestAppVersion")
            for (versions in listOf(minimum, latest)) {
                fields(versions, "android", "ios")
                for (platform in listOf("android", "ios")) require(versions.opt(platform) is String && version.matches(versions.getString(platform)))
            }
            for (platform in listOf("android", "ios")) require(versionAtLeast(latest.getString(platform), minimum.getString(platform)))
            val ads = root.getJSONObject("ads")
            fields(ads, "enabled", "testMode", "audience", "banner", "interstitial", "platforms", "requestTimeoutMs", "retryCount", "retryBackoffMs")
            val banner = ads.getJSONObject("banner").also { fields(it, "enabled") }
            val interstitial = ads.getJSONObject("interstitial").also { fields(it, "enabled", "cooldownSeconds", "maxPerSession") }
            val platforms = ads.getJSONObject("platforms").also { fields(it, "android", "ios") }
            for (key in listOf("android", "ios")) {
                val inventory = platforms.getJSONObject(key)
                fields(inventory, "bannerUnitId", "interstitialUnitId")
                for (format in listOf("bannerUnitId", "interstitialUnitId")) {
                    val id = inventory.opt(format) as? String ?: error("Invalid unit")
                    require(id.isEmpty() || unit.matches(id))
                }
                if (bool(ads, "enabled") && !bool(ads, "testMode")) {
                    require(!bool(banner, "enabled") || inventory.getString("bannerUnitId").isNotEmpty())
                    require(!bool(interstitial, "enabled") || inventory.getString("interstitialUnitId").isNotEmpty())
                }
            }
            val platform = platforms.getJSONObject("android")
            val web = root.getJSONObject("web")
            fields(web, "mode", "origin", "minimumBridgeVersion", "rolloutPercent", "bundleUpdatesEnabled")
            require(web.opt("mode") == "hosted" && web.opt("origin") == "https://ayin.stream")
            require(range(web, "minimumBridgeVersion", 1, 1) == 1 && !bool(web, "bundleUpdatesEnabled"))
            val audience = ads.opt("audience") as? String ?: error("Invalid audience")
            require(audience in setOf("unknown", "general", "children"))
            require(!bool(ads, "enabled") || audience == "general")
            val analytics = root.getJSONObject("analytics").also { fields(it, "enabled") }
            val notifications = root.getJSONObject("notifications").also { fields(it, "enabled", "types", "richMedia") }
            require(!bool(notifications, "richMedia"))
            val values = notifications.getJSONArray("types")
            val allowedTypes = (0 until values.length()).map { values.get(it) as? String ?: error("Invalid type") }
            require(allowedTypes.size <= 7 && allowedTypes.toSet().size == allowedTypes.size && types.containsAll(allowedTypes))
            return MobileConfig(bool(ads, "enabled"), bool(ads, "testMode"), audience,
                bool(banner, "enabled"), bool(interstitial, "enabled"), platform.getString("bannerUnitId"), platform.getString("interstitialUnitId"),
                range(interstitial, "cooldownSeconds", 60, 3600), range(interstitial, "maxPerSession", 0, 20),
                range(ads, "requestTimeoutMs", 1000, 30000), range(ads, "retryCount", 0, 3),
                range(ads, "retryBackoffMs", 500, 30000), bool(analytics, "enabled"), bool(notifications, "enabled"),
                allowedTypes.toSet(), minimum.getString("android"), range(web, "rolloutPercent", 0, 100))
        }
    }
}

/** Strict event allowlist intentionally excludes free text, content identifiers and SDK-owned revenue. */
internal object MobileAnalyticsPolicy {
    fun validate(name: String, params: JSONObject): Boolean {
        val keys = params.keys().asSequence().toSet()
        val expected = when (name) {
            "screen_view" -> setOf("screen_name")
            "video_start", "video_complete", "clip_view", "share" -> setOf("content_type")
            "video_progress" -> setOf("content_type", "position_seconds")
            "search" -> setOf("query_length")
            "follow" -> emptySet()
            "upload_started", "upload_resumed", "upload_completed", "upload_failed" -> setOf("size_bucket")
            else -> return false
        }
        if (keys != expected) return false
        return when (name) {
            "screen_view" -> params.opt("screen_name") in setOf("home", "watch", "clips", "search", "channel", "account", "upload", "other")
            "video_start", "video_complete", "clip_view", "share" -> params.opt("content_type") in setOf("video", "clip")
            "video_progress" -> params.opt("content_type") == "video" && (params.opt("position_seconds") as? Number)?.toDouble()?.let { it.isFinite() && it in 0.0..86400.0 } == true
            "search" -> (params.opt("query_length") as? Number)?.toDouble()?.let { it.isFinite() && it in 0.0..200.0 && it % 1.0 == 0.0 } == true
            "follow" -> true
            else -> params.opt("size_bucket") in setOf("small", "medium", "large", "unknown")
        }
    }
}
