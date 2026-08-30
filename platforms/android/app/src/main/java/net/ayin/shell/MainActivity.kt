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
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
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
            addJavascriptInterface(AyinJavascriptBridge(), "AyinNative")
            webViewClient = AyinWebViewClient()
            webChromeClient = AyinChromeClient()
        }
        setContentView(webView)
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
        webView.removeJavascriptInterface("AyinNative")
        webView.stopLoading()
        webView.loadUrl("about:blank")
        webView.clearHistory()
        webView.removeAllViews()
        webView.destroy()
        super.onDestroy()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN) {
            val key = remoteKey(event.keyCode)
            if (key != null) {
                emitRemoteKey(key)
                return true
            }
        }
        return super.dispatchKeyEvent(event)
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        emitLifecycle("configuration-change")
    }

    private fun loadIntent(intent: Intent) {
        val target = normalizeDeepLink(intent.data) ?: Uri.parse(BuildConfig.AYIN_ORIGIN)
        webView.loadUrl(target.toString())
    }

    private fun normalizeDeepLink(uri: Uri?): Uri? {
        if (uri == null) return null
        if (uri.scheme == "https" && uri.host == "ayin.stream") return uri
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

    private fun remoteKey(keyCode: Int): String? = when (keyCode) {
        KeyEvent.KEYCODE_DPAD_UP -> "UP"
        KeyEvent.KEYCODE_DPAD_DOWN -> "DOWN"
        KeyEvent.KEYCODE_DPAD_LEFT -> "LEFT"
        KeyEvent.KEYCODE_DPAD_RIGHT -> "RIGHT"
        KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> "SELECT"
        KeyEvent.KEYCODE_BACK -> "BACK"
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
            if (uri.scheme == "https" && uri.host == "ayin.stream") return false
            startActivity(Intent(Intent.ACTION_VIEW, uri))
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
    }

    private inner class AyinJavascriptBridge {
        @JavascriptInterface
        fun getPlatform(): String = BuildConfig.SHELL_PLATFORM

        @JavascriptInterface
        fun openExternal(url: String) {
            val uri = runCatching { Uri.parse(url) }.getOrNull() ?: return
            runOnUiThread { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
        }

        @JavascriptInterface
        fun setFullscreen(enabled: Boolean) {
            runOnUiThread {
                window.decorView.systemUiVisibility = if (enabled) {
                    View.SYSTEM_UI_FLAG_FULLSCREEN or
                        View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                } else {
                    View.SYSTEM_UI_FLAG_VISIBLE
                }
            }
        }

        @JavascriptInterface
        fun notifyPlaybackState(state: String) {
            // Intentionally bounded: a later MediaSession adapter can consume this state.
            // The thin shell does not duplicate the web player's playback state machine.
            state.take(64)
        }
    }
}
