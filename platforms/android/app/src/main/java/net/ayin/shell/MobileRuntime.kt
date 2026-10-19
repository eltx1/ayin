package net.ayin.shell

import android.content.Intent
import android.widget.FrameLayout
import org.json.JSONArray
import org.json.JSONObject

/** Fixed, versioned bridge contract. No reflection or arbitrary native method invocation. */
internal interface MobileRuntime {
    val capabilities: List<String>
    fun request(method: String, params: JSONObject, done: (JSONObject?, String?) -> Unit)
    fun resume() {}
    fun pause() {}
    fun destroy() {}
    fun navigation() {}
    fun playback(playing: Boolean) {}
    fun sensitive(active: Boolean) {}
    fun opened(intent: Intent) {}
    fun pageReady() {}
}

internal object MobileBridgePolicy {
    val methods = setOf("runtime.configure", "privacy.request", "privacy.options", "analytics.consent",
        "analytics.event", "analytics.user", "ads.banner", "ads.hideBanner", "ads.interstitial",
        "notifications.request", "notifications.token", "session.reset")
    fun validId(value: String) = value.matches(Regex("[A-Za-z0-9_-]{1,80}"))
    fun bootstrap(capabilities: List<String>): String = """
        (() => {
          if (window.top !== window || window.AyinMobile || !window.AyinNativeTransport) return;
          const transport = window.AyinNativeTransport;
          Object.defineProperty(window, 'AyinMobile', { value: Object.freeze({
            version: 1,
            platform: 'android',
            appVersion: ${JSONObject.quote(BuildConfig.VERSION_NAME)},
            capabilities: Object.freeze(${JSONArray(capabilities)}),
            request: (message) => {
              if (!message || typeof message !== 'object') return;
              transport.postMessage(JSON.stringify({type:'mobile', id:message.id, method:message.method, params:message.params}));
            }
          }), writable:false, configurable:false });
        })();
    """.trimIndent()
}

internal class UnsupportedMobileRuntime : MobileRuntime {
    override val capabilities = emptyList<String>()
    override fun request(method: String, params: JSONObject, done: (JSONObject?, String?) -> Unit) = done(null, "UNSUPPORTED_CAPABILITY")
}
