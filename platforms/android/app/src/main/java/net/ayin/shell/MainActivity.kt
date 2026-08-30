package net.ayin.shell

import android.annotation.SuppressLint
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.mediaPlaybackRequiresUserGesture = false
            settings.cacheMode = WebSettings.LOAD_DEFAULT
            settings.setSupportZoom(false)
            isFocusable = true
            isFocusableInTouchMode = true
            webViewClient = AyinWebViewClient()
            webChromeClient = AyinChromeClient()
        }
        installOriginScopedBridge(webView)
        setContentView(webView)
        webView.requestFocus()
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                when {
                    customView != null -> hideCustomView()
                    webView.canGoBack() -> webView.goBack()
                    else -> finish()
                }
            }
        })
        loadIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        loadIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        webView.resumeTimers()
        emitLifecycle("resume")
    }

    override fun onPause() {
        emitLifecycle("pause")
        webView.onPause()
        super.onPause()
    }

    override fun onStop() {
        emitLifecycle("stop")
        super.onStop()
    }

    override fun onDestroy() {
        customViewCallback = null
        customView = null
        webView.stopLoading()
        webView.loadUrl("about:blank")
        webView.clearHistory()
        webView.removeAllViews()
        webView.destroy()
        super.onDestroy()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.keyCode == KeyEvent.KEYCODE_BACK) {
            if (event.action == KeyEvent.ACTION_DOWN) emitRemoteKey("BACK")
            if (event.action == KeyEvent.ACTION_UP) onBackPressedDispatcher.onBackPressed()
            return true
        }

        if (event.action == KeyEvent.ACTION_DOWN) {
            val key = mediaRemoteKey(event.keyCode)
            if (key != null) {
                emitRemoteKey(key)
                return true
            }
        }

        // D-pad/Enter deliberately remain normal WebView keyboard events so the shared
        // web TV focus system remains the single source of truth for traversal.
        return super.dispatchKeyEvent(event)
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        emitLifecycle("configuration-change")
    }

    private fun installOriginScopedBridge(view: WebView) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return

        WebViewCompat.addWebMessageListener(
            view,
            "AyinNativeTransport",
            setOf(AYIN_ORIGIN_RULE),
        ) { _, message, sourceOrigin, isMainFrame, _ ->
            if (!isMainFrame || !isTrustedOrigin(sourceOrigin)) return@addWebMessageListener
            val data = message.data ?: return@addWebMessageListener
            handleBridgeMessage(data)
        }

        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return
        WebViewCompat.addDocumentStartJavaScript(
            view,
            nativeBridgeBootstrapScript(),
            setOf(AYIN_ORIGIN_RULE),
        )
    }

    private fun nativeBridgeBootstrapScript(): String {
        val platform = JSONObject.quote(BuildConfig.SHELL_PLATFORM)
        return """
            (() => {
              const transport = window.AyinNativeTransport;
              if (!transport) return;
              const send = (payload) => transport.postMessage(JSON.stringify(payload));
              const bridge = Object.freeze({
                getPlatform: () => $platform,
                openExternal: (url) => send({ type: 'openExternal', url: String(url).slice(0, 2048) }),
                setFullscreen: (enabled) => send({ type: 'setFullscreen', enabled: Boolean(enabled) }),
                notifyPlaybackState: (state) => send({ type: 'notifyPlaybackState', state: String(state).slice(0, 64) })
              });
              Object.defineProperty(window, 'AyinNative', {
                value: bridge,
                configurable: false,
                enumerable: false,
                writable: false
              });
            })();
        """.trimIndent()
    }

    private fun handleBridgeMessage(raw: String) {
        if (raw.length > MAX_BRIDGE_MESSAGE_LENGTH) return
        val payload = runCatching { JSONObject(raw) }.getOrNull() ?: return
        when (payload.optString("type")) {
            "openExternal" -> {
                val url = payload.optString("url").take(MAX_EXTERNAL_URL_LENGTH)
                val uri = runCatching { Uri.parse(url) }.getOrNull() ?: return
                runOnUiThread { openExternalUri(uri) }
            }
            "setFullscreen" -> runOnUiThread { setFullscreen(payload.optBoolean("enabled", false)) }
            "notifyPlaybackState" -> {
                // Bounded state notification reserved for a future native MediaSession adapter.
                payload.optString("state").take(MAX_PLAYBACK_STATE_LENGTH)
            }
        }
    }

    private fun isTrustedOrigin(origin: Uri): Boolean =
        origin.scheme == "https" && origin.host == AYIN_HOST && (origin.port == -1 || origin.port == 443)

    private fun loadIntent(intent: Intent) {
        val target = normalizeDeepLink(intent.data) ?: Uri.parse(BuildConfig.AYIN_ORIGIN)
        webView.loadUrl(target.toString())
    }

    private fun normalizeDeepLink(uri: Uri?): Uri? {
        if (uri == null) return null
        if (uri.scheme == "https" && uri.host == AYIN_HOST) return uri
        if (uri.scheme != "ayin") return null
        val host = uri.host?.trim('/') ?: return Uri.parse(BuildConfig.AYIN_ORIGIN)
        val path = uri.path ?: ""
        return Uri.parse(BuildConfig.AYIN_ORIGIN).buildUpon()
            .encodedPath("/$host$path")
            .encodedQuery(uri.encodedQuery)
            .encodedFragment(uri.encodedFragment)
            .build()
    }

    private fun emitRemoteKey(key: String) {
        if (!::webView.isInitialized) return
        val payload = JSONObject().put("key", key).toString()
        webView.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('ayin:native-remote',{detail:$payload}));",
            null,
        )
    }

    private fun emitLifecycle(state: String) {
        if (!::webView.isInitialized) return
        val payload = JSONObject().put("state", state).toString()
        webView.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('ayin:native-lifecycle',{detail:$payload}));",
            null,
        )
    }

    private fun mediaRemoteKey(keyCode: Int): String? = when (keyCode) {
        KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> "PLAY_PAUSE"
        KeyEvent.KEYCODE_MEDIA_PLAY -> "PLAY"
        KeyEvent.KEYCODE_MEDIA_PAUSE -> "PAUSE"
        KeyEvent.KEYCODE_MEDIA_REWIND -> "REWIND"
        KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> "FAST_FORWARD"
        KeyEvent.KEYCODE_MENU -> "MENU"
        else -> null
    }

    private inner class AyinWebViewClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val uri = request.url
            if (uri.scheme == "https" && uri.host == AYIN_HOST) return false
            openExternalUri(uri)
            return true
        }
    }

    private inner class AyinChromeClient : WebChromeClient() {
        override fun onShowCustomView(view: View, callback: CustomViewCallback) {
            if (customView != null) {
                callback.onCustomViewHidden()
                return
            }
            customView = view
            customViewCallback = callback
            addContentView(
                view,
                ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT,
                ),
            )
            webView.visibility = View.GONE
        }

        override fun onHideCustomView() = hideCustomView()
    }

    private fun hideCustomView() {
        val view = customView ?: return
        (view.parent as? ViewGroup)?.removeView(view)
        customView = null
        customViewCallback?.onCustomViewHidden()
        customViewCallback = null
        webView.visibility = View.VISIBLE
        webView.requestFocus()
    }

    private fun openExternalUri(uri: Uri) {
        if (uri.scheme !in setOf("https", "http", "mailto", "tel")) return
        runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
    }

    private fun setFullscreen(enabled: Boolean) {
        window.decorView.systemUiVisibility = if (enabled) {
            View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        } else {
            View.SYSTEM_UI_FLAG_VISIBLE
        }
    }

    companion object {
        private const val AYIN_HOST = "ayin.stream"
        private const val AYIN_ORIGIN_RULE = "https://ayin.stream"
        private const val MAX_BRIDGE_MESSAGE_LENGTH = 4096
        private const val MAX_EXTERNAL_URL_LENGTH = 2048
        private const val MAX_PLAYBACK_STATE_LENGTH = 64
    }
}
