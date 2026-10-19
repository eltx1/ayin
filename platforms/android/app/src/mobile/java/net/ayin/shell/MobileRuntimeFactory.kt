package net.ayin.shell

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.FrameLayout
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.analytics.FirebaseAnalytics
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.crashlytics.FirebaseCrashlytics
import org.json.JSONObject

internal object MobileRuntimeFactory {
    fun create(activity: MainActivity, bannerHost: FrameLayout, emit: (JSONObject) -> Unit): MobileRuntime = GoogleMobileRuntime(activity, bannerHost, emit)
}

internal class GoogleMobileRuntime(
    private val activity: MainActivity,
    bannerHost: FrameLayout,
    private val emit: (JSONObject) -> Unit,
) : MobileRuntime {
    private val firebaseReady = FirebaseApp.getApps(activity).isNotEmpty()
    private val adsReady = BuildConfig.ADMOB_APP_ID.matches(Regex("ca-app-pub-[0-9]{16}~[0-9]{10}"))
    private val analytics = if (firebaseReady) FirebaseAnalytics.getInstance(activity) else null
    private val crashlytics = if (firebaseReady) FirebaseCrashlytics.getInstance() else null
    private val prefs = MobilePushState.prefs(activity)
    private var config = MobileConfig()
    private var analyticsConsent = false
    private var active = false
    private var destroyed = false
    private var pendingNotification: JSONObject? = null
    private var permissionDone: ((JSONObject?, String?) -> Unit)? = null
    private var tokenResetting = false
    private var sensitiveOperation = false
    private val ads = MobileAdsController(activity, bannerHost, ::nativeEvent, adsReady)
    private val permission = activity.activityResultRegistry.register("ayin_notification_permission", ActivityResultContracts.RequestPermission()) { granted ->
        val callback = permissionDone
        permissionDone = null
        if (!granted) prefs.edit().putBoolean("push_enabled", false).commit()
        callback?.invoke(JSONObject().put("granted", granted), null)
    }

    init {
        // Collection remains off until the currently authenticated account opts in this session.
        analytics?.setAnalyticsCollectionEnabled(false)
        analytics?.setUserId(null)
        crashlytics?.setCrashlyticsCollectionEnabled(false)
        crashlytics?.deleteUnsentReports()
        MobilePushState.channel(activity)
        MobilePushState.listener = { event -> if (!destroyed) nativeEvent(event) }
    }

    override val capabilities: List<String> = buildList {
        add("session.reset")
        if (adsReady) { add("privacy"); add("ads.banner"); add("ads.interstitial") }
        if (firebaseReady) { add("analytics"); add("notifications") }
    }

    override fun request(method: String, params: JSONObject, done: (JSONObject?, String?) -> Unit) {
        if (destroyed) { done(null, "DESTROYED"); return }
        when (method) {
            "runtime.configure" -> {
                require(params.keys().asSequence().toSet() == setOf("config"))
                if (sensitiveOperation || ads.isPresenting) { done(null, "SENSITIVE_OPERATION"); return }
                val received = MobileConfig.parse(params.getJSONObject("config"))
                val upgradeRequired = !MobileConfig.versionAtLeast(BuildConfig.VERSION_NAME, received.minimumAppVersion)
                val eligible = !upgradeRequired &&
                    MobileConfig.rolloutBucket(MobilePushState.installationId(activity)) < received.rolloutPercent
                val parsed = if (eligible) received else received.copy(adsEnabled = false, analyticsEnabled = false, notificationsEnabled = false)
                // Ads controller defers configuration while fullscreen inventory is visible.
                config = parsed
                ads.configure(parsed)
                val typeEditor = prefs.edit()
                for (type in listOf("system", "channel", "video", "comment", "subscription", "moderation", "monetization")) typeEditor.putBoolean("push_type_$type", type in parsed.notificationTypes)
                typeEditor.commit()
                updateAnalyticsConsent()
                if (!config.notificationsEnabled) {
                    prefs.edit().putBoolean("push_enabled", false).commit()
                    if (firebaseReady) FirebaseMessaging.getInstance().isAutoInitEnabled = false
                }
                pendingNotification?.let(::nativeEvent)
                pendingNotification = null
                done(JSONObject().put("platform", "android").put("appVersion", BuildConfig.VERSION_NAME)
                    .put("runtimeAllowed", eligible).put("upgradeRequired", upgradeRequired)
                    .put("installationId", MobilePushState.installationId(activity))
                    .put("boundAccountId", prefs.getString("account_id", null) ?: JSONObject.NULL)
                    .put("configured", JSONObject().put("firebase", firebaseReady).put("ads", adsReady)), null)
            }
            "privacy.request", "privacy.options", "ads.banner", "ads.hideBanner", "ads.interstitial" -> ads.request(method, params, done)
            "analytics.consent" -> {
                require(params.keys().asSequence().toSet() == setOf("enabled") && params.opt("enabled") is Boolean)
                analyticsConsent = params.getBoolean("enabled")
                updateAnalyticsConsent()
                if (!analyticsConsent) { analytics?.setUserId(null); analytics?.resetAnalyticsData() }
                done(JSONObject().put("enabled", analyticsConsent && config.analyticsEnabled && firebaseReady), null)
            }
            "analytics.user" -> {
                require(params.keys().asSequence().toSet() == setOf("id"))
                val id = if (params.isNull("id")) null else params.getString("id").also { require(it.matches(Regex("[A-Za-z0-9_-]{1,128}"))) }
                analytics?.setUserId(id.takeIf { analyticsConsent && config.analyticsEnabled })
                done(JSONObject(), null)
            }
            "analytics.event" -> {
                val name = params.getString("name")
                val values = params.getJSONObject("params")
                require(params.keys().asSequence().toSet() == setOf("name", "params") && MobileAnalyticsPolicy.validate(name, values))
                if (!firebaseReady || !config.analyticsEnabled || !analyticsConsent) { done(null, "ANALYTICS_DISABLED"); return }
                val bundle = Bundle()
                values.keys().forEach { key -> when(val value = values.get(key)) {
                    is String -> bundle.putString(key, value)
                    is Number -> bundle.putDouble(key, value.toDouble())
                } }
                analytics?.logEvent(name, bundle)
                done(JSONObject().put("accepted", true), null)
            }
            "notifications.request", "notifications.token" -> notifications(method, params, done)
            "session.reset" -> {
                require(params.length() == 0)
                analyticsConsent = false
                permissionDone?.invoke(null, "SESSION_CHANGED")
                permissionDone = null
                pendingNotification = null
                analytics?.setUserId(null)
                analytics?.setAnalyticsCollectionEnabled(false)
                analytics?.resetAnalyticsData()
                crashlytics?.setCrashlyticsCollectionEnabled(false)
                crashlytics?.deleteUnsentReports()
                synchronized(MobilePushState.deliveryLock) {
                    prefs.edit().remove("account_id").putBoolean("push_enabled", false).commit()
                    NotificationManagerCompat.from(activity).cancelAll()
                }
                ads.reset()
                if (firebaseReady) {
                    FirebaseMessaging.getInstance().isAutoInitEnabled = false
                    tokenResetting = true
                    FirebaseMessaging.getInstance().deleteToken().addOnCompleteListener {
                        tokenResetting = false
                        done(JSONObject().put("detached", true).put("tokenDeleted", it.isSuccessful), null)
                    }
                } else done(JSONObject().put("detached", true), null)
            }
            else -> done(null, "UNSUPPORTED_METHOD")
        }
    }

    private fun updateAnalyticsConsent() {
        val enabled = analyticsConsent && config.analyticsEnabled
        analytics?.setConsent(mapOf(
            FirebaseAnalytics.ConsentType.ANALYTICS_STORAGE to if (enabled) FirebaseAnalytics.ConsentStatus.GRANTED else FirebaseAnalytics.ConsentStatus.DENIED,
            FirebaseAnalytics.ConsentType.AD_STORAGE to FirebaseAnalytics.ConsentStatus.DENIED,
            FirebaseAnalytics.ConsentType.AD_USER_DATA to FirebaseAnalytics.ConsentStatus.DENIED,
            FirebaseAnalytics.ConsentType.AD_PERSONALIZATION to FirebaseAnalytics.ConsentStatus.DENIED))
        analytics?.setAnalyticsCollectionEnabled(enabled)
        crashlytics?.setCrashlyticsCollectionEnabled(enabled)
        if (!enabled) crashlytics?.deleteUnsentReports()
        if (!enabled) analytics?.setUserId(null)
    }

    private fun notifications(method: String, params: JSONObject, done: (JSONObject?, String?) -> Unit) {
        require(params.keys().asSequence().toSet() == setOf("accountId"))
        val account = params.getString("accountId")
        require(MobilePushState.validUuid(account))
        if (tokenResetting) { done(null, "TOKEN_RESETTING"); return }
        if (!firebaseReady || !config.notificationsEnabled) { done(null, "NOTIFICATIONS_DISABLED"); return }
        val old = prefs.getString("account_id", null)
        if (old != null && old != account) { done(null, "SESSION_RESET_REQUIRED"); return }
        prefs.edit().putString("account_id", account).commit()
        if (method == "notifications.request") {
            if (!active || permissionDone != null) { done(null, "NOT_FOREGROUND_OR_BUSY"); return }
            prefs.edit().putBoolean("push_enabled", true).commit()
            if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                permissionDone = done
                permission.launch(Manifest.permission.POST_NOTIFICATIONS)
            } else done(JSONObject().put("granted", NotificationManagerCompat.from(activity).areNotificationsEnabled()), null)
            return
        }
        if (!MobilePushState.allowed(activity)) { done(JSONObject().put("token", JSONObject.NULL), null); return }
        FirebaseMessaging.getInstance().isAutoInitEnabled = true
        FirebaseMessaging.getInstance().token.addOnCompleteListener { result ->
            if (destroyed || prefs.getString("account_id", null) != account || !MobilePushState.allowed(activity)) { done(null, "SESSION_CHANGED"); return@addOnCompleteListener }
            if (result.isSuccessful) done(JSONObject().put("token", result.result), null) else done(null, "FCM_TOKEN_FAILED")
        }
    }

    private fun nativeEvent(event: JSONObject) {
        emit(event)
        if (!analyticsConsent || !config.analyticsEnabled || destroyed) return
        val name = when (event.optString("type")) {
            "ad.request" -> "ad_request"
            "ad.loaded" -> "ad_loaded"
            "ad.failed" -> "ad_failed"
            "notification.received" -> "notification_received"
            "notification.opened" -> "notification_opened"
            else -> return
        }
        val bundle = Bundle().apply {
            if (event.has("format")) putString("ad_format", event.optString("format"))
            if (event.has("placement")) putString("placement", event.optString("placement"))
            if (event.has("code")) putLong("error_code", event.optInt("code").toLong())
        }
        analytics?.logEvent(name, bundle)
    }

    override fun playback(playing: Boolean) { ads.playback(playing) }
    override fun sensitive(active: Boolean) { sensitiveOperation = active; ads.sensitive(active) }
    override fun resume() { active = true; ads.resume() }
    override fun pause() { active = false; ads.pause() }
    override fun navigation() { ads.navigation() }
    override fun opened(intent: Intent) {
        val id = intent.getStringExtra("ayin_notification_id") ?: return
        val account = intent.getStringExtra("ayin_recipient_id") ?: return
        if (prefs.getString("account_id", null) != account) return
        pendingNotification = JSONObject().put("type", "notification.opened").put("notificationId", id).put("route", "/notifications").put("recipientAccountId", account)
        intent.removeExtra("ayin_notification_id")
    }
    override fun pageReady() { /* Delivery waits for runtime.configure after the web installs its event listener. */ }
    override fun destroy() {
        destroyed = true
        MobilePushState.listener = null
        permissionDone?.invoke(null, "DESTROYED")
        permissionDone = null
        permission.unregister()
        ads.destroy()
    }
}
