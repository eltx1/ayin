package net.ayin.shell

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.View
import android.widget.FrameLayout
import com.google.android.gms.ads.AdError
import com.google.android.gms.ads.AdListener
import com.google.android.gms.ads.AdRequest
import com.google.android.gms.ads.AdSize
import com.google.android.gms.ads.AdValue
import com.google.android.gms.ads.AdView
import com.google.android.gms.ads.FullScreenContentCallback
import com.google.android.gms.ads.LoadAdError
import com.google.android.gms.ads.MobileAds
import com.google.android.gms.ads.RequestConfiguration
import com.google.android.gms.ads.interstitial.InterstitialAd
import com.google.android.gms.ads.interstitial.InterstitialAdLoadCallback
import com.google.android.ump.ConsentInformation
import com.google.android.ump.ConsentRequestParameters
import com.google.android.ump.UserMessagingPlatform
import org.json.JSONObject
import java.util.UUID

/** SDK-backed inventory. Interstitial loading never shows an ad asynchronously over content. */
internal class MobileAdsController(
    private val activity: MainActivity,
    private val host: FrameLayout,
    private val emit: (JSONObject) -> Unit,
    private val configured: Boolean,
) {
    private var config = MobileConfig()
    private var deferredConfig: MobileConfig? = null
    private val handler = Handler(Looper.getMainLooper())
    private val consent = UserMessagingPlatform.getConsentInformation(activity)
    private var consentRefreshed = false
    private var ageAllowed = false
    private var consentBusy = false
    private var initialized = false
    private var initializing = false
    private var active = false
    private var destroyed = false
    private var epoch = 0
    private var playing = false
    private var sensitive = false
    val isPresenting: Boolean get() = interstitialShowing || consentBusy
    private var banner: AdView? = null
    private var bannerLoading = false
    private var bannerPlacement = ""
    private var bannerGeneration = 0
    private var interstitial: InterstitialAd? = null
    private var interstitialLoading = false
    private var interstitialShowing = false
    private var interstitialGeneration = 0
    private var interstitialLoadedAt = 0L
    private var lastInterstitialAt = -3_600_000L
    private var lastInterstitialRequestAt = -3_600_000L
    private var shownThisSession = 0
    private var paidEvents = mutableSetOf<String>()

    fun configure(value: MobileConfig) {
        if (interstitialShowing) { deferredConfig = value; return }
        if (value != config) { hideBanner(); clearInterstitial() }
        config = value
    }

    fun request(method: String, p: JSONObject, done: (JSONObject?, String?) -> Unit) {
        if (destroyed || !configured) { done(null, "ADS_NOT_CONFIGURED"); return }
        when (method) {
            "privacy.request" -> requestConsent(p, done)
            "privacy.options" -> {
                require(p.length() == 0)
                if (!active || consentBusy || interstitialShowing) { done(null, "BUSY_OR_BACKGROUND"); return }
                if (consent.privacyOptionsRequirementStatus != ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED) {
                    done(privacyStatus(), null); return
                }
                hideBanner(); clearInterstitial(); consentBusy = true
                UserMessagingPlatform.showPrivacyOptionsForm(activity) { error ->
                    consentBusy = false
                    emit(privacyStatus().put("type", "privacy.changed"))
                    done(privacyStatus(), error?.let { "UMP_${it.errorCode}" })
                }
            }
            "ads.hideBanner" -> { require(p.length() == 0); hideBanner(); done(JSONObject(), null) }
            "ads.banner" -> {
                require(p.keys().asSequence().toSet() == setOf("placement"))
                val placement = placement(p).also { require(it == "browse_bottom") }
                if (!canRequest() || !config.bannerEnabled) { done(null, "ADS_DISABLED_OR_CONSENT_REQUIRED"); return }
                if (banner != null && bannerPlacement == placement) { done(JSONObject().put("state", if(bannerLoading) "loading" else "ready"), null); return }
                initialize { ready ->
                    if (!ready || !canRequest()) { done(null, "ADS_NOT_READY"); return@initialize }
                    loadBanner(placement, 0)
                    done(JSONObject().put("state", "loading"), null)
                }
            }
            "ads.interstitial" -> {
                require(p.keys().asSequence().toSet() == setOf("placement", "naturalTransition") && p.opt("naturalTransition") == true)
                val placement = placement(p).also { require(it == "browse_transition") }
                if (!canRequest() || !config.interstitialEnabled || interstitialShowing || shownThisSession >= config.maxPerSession) { done(null, "ADS_DISABLED_OR_CAPPED"); return }
                if (SystemClock.elapsedRealtime() - lastInterstitialAt < config.cooldownSeconds * 1000L) { done(null, "COOLDOWN"); return }
                val ad = interstitial
                if (ad != null && SystemClock.elapsedRealtime() - interstitialLoadedAt < 3_600_000) {
                    interstitial = null
                    interstitialShowing = true
                    hideBanner()
                    ad.fullScreenContentCallback = object : FullScreenContentCallback() {
                        override fun onAdShowedFullScreenContent() {
                            shownThisSession++
                            lastInterstitialAt = SystemClock.elapsedRealtime()
                            event("ad.shown", "interstitial", placement)
                        }
                        override fun onAdDismissedFullScreenContent() { interstitialShowing = false; event("ad.dismissed", "interstitial", placement); applyDeferred() }
                        override fun onAdFailedToShowFullScreenContent(error: AdError) { interstitialShowing = false; event("ad.failed", "interstitial", placement, error.code); applyDeferred() }
                    }
                    ad.show(activity)
                    done(JSONObject().put("state", "showing"), null)
                } else {
                    if (interstitialLoading) { done(JSONObject().put("state", "loading"), null); return }
                    if (SystemClock.elapsedRealtime() - lastInterstitialRequestAt < 30_000) { done(null, "RETRY_COOLDOWN"); return }
                    initialize { ready ->
                        if (!ready || !canRequest()) { done(null, "ADS_NOT_READY"); return@initialize }
                        loadInterstitial(placement, 0)
                        done(JSONObject().put("state", "loading"), null)
                    }
                }
            }
            else -> done(null, "UNSUPPORTED_METHOD")
        }
    }

    private fun placement(p: JSONObject) = p.getString("placement").also { require(it.matches(Regex("[a-z][a-z0-9_]{0,39}"))) }
    private fun requestConsent(p: JSONObject, done: (JSONObject?, String?) -> Unit) {
        require(p.keys().asSequence().toSet().all { it == "underAgeOfConsent" })
        if (!active || consentBusy || interstitialShowing) { done(null, "BUSY_OR_BACKGROUND"); return }
        if (config.audience == "unknown") { done(null, "AUDIENCE_NOT_CONFIGURED"); return }
        ageAllowed = false
        val underAge = when {
            p.opt("underAgeOfConsent") is Boolean -> p.getBoolean("underAgeOfConsent")
            config.audience == "children" -> true
            else -> { done(null, "AGE_SIGNAL_REQUIRED"); return }
        }
        // Child-directed operation is not enabled without a separately reviewed product policy.
        if (underAge || config.audience == "children") { hideBanner(); clearInterstitial(); done(null, "AGE_RESTRICTED_ADS_DISABLED"); return }
        ageAllowed = true
        consentBusy = true
        val requestEpoch = epoch
        hideBanner(); clearInterstitial()
        @Suppress("DEPRECATION")
        val requestConfig = RequestConfiguration.Builder()
            .setTagForChildDirectedTreatment(RequestConfiguration.TAG_FOR_CHILD_DIRECTED_TREATMENT_FALSE)
            .setTagForUnderAgeOfConsent(RequestConfiguration.TAG_FOR_UNDER_AGE_OF_CONSENT_FALSE).build()
        MobileAds.setRequestConfiguration(requestConfig)
        val parameters = ConsentRequestParameters.Builder().setTagForUnderAgeOfConsent(false).build()
        consent.requestConsentInfoUpdate(activity, parameters, {
            if (requestEpoch != epoch || destroyed) { done(null, "SESSION_CHANGED"); return@requestConsentInfoUpdate }
            consentRefreshed = true
            if (!active || destroyed) { consentBusy = false; done(null, "BACKGROUND"); return@requestConsentInfoUpdate }
            UserMessagingPlatform.loadAndShowConsentFormIfRequired(activity) { error ->
                if (requestEpoch != epoch || destroyed) { done(null, "SESSION_CHANGED"); return@loadAndShowConsentFormIfRequired }
                consentBusy = false
                emit(privacyStatus().put("type", "privacy.changed"))
                done(privacyStatus(), error?.let { "UMP_${it.errorCode}" })
            }
        }, { error ->
            if (requestEpoch != epoch || destroyed) { done(null, "SESSION_CHANGED"); return@requestConsentInfoUpdate }
            consentRefreshed = true
            consentBusy = false
            emit(privacyStatus().put("type", "privacy.changed"))
            done(privacyStatus(), "UMP_${error.errorCode}")
        })
    }
    private fun privacyStatus() = JSONObject().put("canRequestAds", consentRefreshed && consent.canRequestAds())
        .put("privacyOptionsRequired", consent.privacyOptionsRequirementStatus == ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED)
    private fun canRequest() = active && !destroyed && configured && config.adsEnabled && config.audience == "general" && !playing && !sensitive && ageAllowed && consentRefreshed && !consentBusy && consent.canRequestAds()
    private fun initialize(done: (Boolean) -> Unit) {
        if (initialized) { done(true); return }
        if (initializing) { done(false); return }
        initializing = true
        val requestEpoch = epoch
        var completed = false
        handler.postDelayed({ if (!completed) { completed = true; initializing = false; done(false) } }, 15000)
        MobileAds.initialize(activity) {
            activity.runOnUiThread {
                initialized = true
                initializing = false
                if (!completed) { completed = true; done(requestEpoch == epoch && !destroyed) }
            }
        }
    }
    private fun adUnit(format: String): String {
        if (BuildConfig.DEBUG || config.testMode) return if (format == "banner") "ca-app-pub-3940256099942544/6300978111" else "ca-app-pub-3940256099942544/1033173712"
        return if (format == "banner") config.bannerUnitId else config.interstitialUnitId
    }
    private fun request() = AdRequest.Builder().setHttpTimeoutMillis(config.requestTimeoutMs).build()
    private fun loadBanner(placement: String, attempt: Int) {
        if (!canRequest() || interstitialShowing) return
        val id = adUnit("banner")
        if (id.isEmpty()) { event("ad.failed", "banner", placement, -2); return }
        hideBanner()
        val generation = ++bannerGeneration
        bannerLoading = true
        bannerPlacement = placement
        val view = AdView(activity)
        banner = view
        view.adUnitId = id
        val width = ((host.width.takeIf { it > 0 } ?: activity.resources.displayMetrics.widthPixels) / activity.resources.displayMetrics.density).toInt().coerceAtLeast(1)
        view.setAdSize(AdSize.getCurrentOrientationAnchoredAdaptiveBannerAdSize(activity, width))
        var paidKey = UUID.randomUUID().toString()
        view.setOnPaidEventListener { value -> revenue("banner", placement, paidKey, value) }
        view.adListener = object : AdListener() {
            override fun onAdLoaded() {
                if (generation != bannerGeneration) return
                if (!canRequest()) { hideBanner(); return }
                bannerLoading = false
                paidKey = UUID.randomUUID().toString()
                host.visibility = View.VISIBLE
                event("ad.loaded", "banner", placement)
            }
            override fun onAdFailedToLoad(error: LoadAdError) {
                if (generation != bannerGeneration) return
                hideBanner()
                event("ad.failed", "banner", placement, error.code)
                // No-fill (3) is inventory availability, never a retry loop.
                if (error.code != 3 && attempt < config.retryCount) handler.postDelayed({
                    if (generation + 1 == bannerGeneration && canRequest()) loadBanner(placement, attempt + 1)
                }, config.retryBackoffMs * (1L shl attempt))
            }
        }
        host.addView(view, FrameLayout.LayoutParams(-1, -2))
        host.visibility = View.VISIBLE
        event("ad.request", "banner", placement)
        view.loadAd(request())
        handler.postDelayed({ if (generation == bannerGeneration && bannerLoading) { hideBanner(); event("ad.failed", "banner", placement, -1) } }, config.requestTimeoutMs.toLong() + 1000)
    }
    private fun loadInterstitial(placement: String, attempt: Int) {
        if (!canRequest() || interstitialShowing) return
        val id = adUnit("interstitial")
        if (id.isEmpty()) { event("ad.failed", "interstitial", placement, -2); return }
        val generation = ++interstitialGeneration
        interstitialLoading = true
        lastInterstitialRequestAt = SystemClock.elapsedRealtime()
        event("ad.request", "interstitial", placement)
        InterstitialAd.load(activity, id, request(), object : InterstitialAdLoadCallback() {
            override fun onAdLoaded(ad: InterstitialAd) {
                if (generation != interstitialGeneration || !canRequest()) return
                interstitialLoading = false
                interstitial = ad
                interstitialLoadedAt = SystemClock.elapsedRealtime()
                val paidKey = UUID.randomUUID().toString()
                ad.setOnPaidEventListener { value -> revenue("interstitial", placement, paidKey, value) }
                event("ad.loaded", "interstitial", placement)
            }
            override fun onAdFailedToLoad(error: LoadAdError) {
                if (generation != interstitialGeneration) return
                interstitialLoading = false
                event("ad.failed", "interstitial", placement, error.code)
                if (error.code != 3 && attempt < config.retryCount) handler.postDelayed({
                    if (generation == interstitialGeneration && canRequest()) loadInterstitial(placement, attempt + 1)
                }, config.retryBackoffMs * (1L shl attempt))
            }
        })
        handler.postDelayed({ if (generation == interstitialGeneration && interstitialLoading) { clearInterstitial(); event("ad.failed", "interstitial", placement, -1) } }, config.requestTimeoutMs.toLong() + 1000)
    }
    private fun event(type: String, format: String, placement: String, code: Int? = null) {
        if (destroyed) return
        emit(JSONObject().put("type", type).put("format", format).put("placement", placement).apply { if(code != null) put("code", code) })
    }
    private fun revenue(format: String, placement: String, id: String, value: AdValue) {
        if (destroyed || !paidEvents.add(id)) return
        if (paidEvents.size > 200) paidEvents = mutableSetOf(id)
        // Diagnostic estimate only. Firebase automatically owns ad_impression; never log it again.
        emit(JSONObject().put("type", "ad.revenue").put("format", format).put("placement", placement)
            .put("eventId", id).put("valueMicros", value.valueMicros).put("currency", value.currencyCode).put("precision", value.precisionType))
    }
    private fun applyDeferred() { deferredConfig?.let { deferredConfig = null; configure(it) } }
    private fun clearInterstitial() { interstitialGeneration++; interstitialLoading = false; interstitial = null }
    private fun hideBanner() { bannerGeneration++; bannerLoading = false; banner?.destroy(); banner = null; host.removeAllViews(); host.visibility = View.GONE }
    fun playback(value: Boolean) { playing = value; if (value) { hideBanner(); clearInterstitial() } }
    fun sensitive(value: Boolean) { sensitive = value; if (value) { hideBanner(); clearInterstitial() } }
    fun resume() { active = true; banner?.resume() }
    fun pause() { active = false; banner?.pause(); hideBanner(); if (!interstitialShowing) clearInterstitial() }
    fun navigation() { hideBanner() }
    fun reset() { epoch++; consentRefreshed = false; ageAllowed = false; consentBusy = false; hideBanner(); clearInterstitial(); shownThisSession = 0 }
    fun destroy() { destroyed = true; active = false; handler.removeCallbacksAndMessages(null); hideBanner(); clearInterstitial() }
}
