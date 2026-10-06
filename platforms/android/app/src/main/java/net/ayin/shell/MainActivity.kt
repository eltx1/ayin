package net.ayin.shell

import android.annotation.SuppressLint
import android.content.ComponentCallbacks2
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Color
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.lifecycleScope
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

class MainActivity : AppCompatActivity() {
    internal lateinit var webView: WebView
    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null
    private var lastTrustedUrl = BuildConfig.AYIN_ORIGIN
    private var mainFrameLoadFailed = false
    private var directBackArmed = false
    private var rendererRecoveryPending = false
    private var shellFullscreen = false
    private var networkCallbackRegistered = false
    private var lastNetworkOnline: Boolean? = null
    private data class VideoSelection(
        val view: WebView,
        val url: String,
        val types: List<String>,
        val callback: ValueCallback<Array<Uri>>,
    )
    private val fileSelection = FileSelectionLease<VideoSelection>()
    private var fileValidationJob: Job? = null
    private val videoPicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val selection = fileSelection.receiveResult() ?: return@registerForActivityResult
        val clip = result.data?.clipData
        val uri = result.data?.data ?: clip?.takeIf { it.itemCount == 1 }?.getItemAt(0)?.uri
        val singleSelection = clip == null || (clip.itemCount == 1 && clip.getItemAt(0).uri == uri)
        val eligible = result.resultCode == RESULT_OK && uri != null &&
            singleSelection && uri.scheme == "content" &&
            ownsFileSelection(selection)
        if (!eligible || uri == null) {
            fileSelection.completeValidation(selection)?.callback?.onReceiveValue(null)
            return@registerForActivityResult
        }
        fileValidationJob = lifecycleScope.launch {
            val selected = withContext(Dispatchers.IO) {
                runCatching {
                    if (!VideoFileSelection.accepts(contentResolver.getType(uri), selection.types)) {
                        null
                    } else {
                        // A temporary user-selected document grant suffices. Never persist it.
                        contentResolver.openFileDescriptor(uri, "r")?.use { arrayOf(uri) }
                    }
                }.getOrNull()
            }
            // Provider I/O may finish after navigation, renderer replacement, or a new request.
            val current = fileSelection.completeValidation(selection) ?: return@launch
            current.callback.onReceiveValue(selected.takeIf { ownsFileSelection(current) })
        }
    }

    private val connectivityManager by lazy {
        getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    }

    private val networkCallback =
        object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) = publishNetworkState()

            override fun onLost(network: Network) = publishNetworkState()

            override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) =
                publishNetworkState()
        }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        CookieManager.getInstance().setAcceptCookie(true)
        attachWebView(createConfiguredWebView())
        registerNetworkCallback()

        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() = handleBackPressed()
            },
        )

        val restored = savedInstanceState?.let { webView.restoreState(it) } != null
        lastTrustedUrl =
            savedInstanceState?.getString(STATE_LAST_TRUSTED_URL)?.takeIf(::isTrustedWebUrl)
                ?: BuildConfig.AYIN_ORIGIN
        directBackArmed = savedInstanceState?.getBoolean(STATE_DIRECT_BACK_ARMED) ?: false

        if (!restored) loadIntent(intent)
        webView.requestFocus()
        debugLog("created platform=${BuildConfig.SHELL_PLATFORM} restored=$restored")
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        loadIntent(intent)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        lastTrustedUrl = currentTrustedUrl()
        outState.putString(STATE_LAST_TRUSTED_URL, lastTrustedUrl)
        outState.putBoolean(STATE_DIRECT_BACK_ARMED, directBackArmed)
        webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
        emitLifecycle("resume")
        debugLog("lifecycle=resume")
    }

    override fun onPause() {
        emitLifecycle("pause")
        CookieManager.getInstance().flush()
        webView.onPause()
        debugLog("lifecycle=pause")
        super.onPause()
    }

    override fun onStop() {
        emitLifecycle("stop")
        CookieManager.getInstance().flush()
        debugLog("lifecycle=stop")
        super.onStop()
    }

    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        if (level >= ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW) {
            emitLifecycle("memory-pressure", level)
            debugLog("memory-pressure=$level")
        }
    }

    override fun onLowMemory() {
        super.onLowMemory()
        emitLifecycle("memory-pressure", ComponentCallbacks2.TRIM_MEMORY_COMPLETE)
        debugLog("memory-pressure=low-memory")
    }

    override fun onDestroy() {
        cancelFileSelection()
        unregisterNetworkCallback()
        customViewCallback = null
        customView = null
        if (::webView.isInitialized) {
            webView.stopLoading()
            webView.loadUrl("about:blank")
            webView.clearHistory()
            (webView.parent as? ViewGroup)?.removeView(webView)
            webView.removeAllViews()
            webView.destroy()
        }
        super.onDestroy()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN) {
            if (event.keyCode != KeyEvent.KEYCODE_BACK && directBackArmed) {
                directBackArmed = false
                debugLog("direct-back=disarmed key=${event.keyCode}")
            }

            val mediaKey = mediaRemoteKey(event.keyCode)
            if (mediaKey != null) {
                emitRemoteKey(mediaKey)
                debugLog("remote=$mediaKey")
                return true
            }

            if (event.keyCode in DPAD_KEY_CODES) {
                debugLog("dpad=${event.keyCode}")
            }
        }

        return super.dispatchKeyEvent(event)
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        emitLifecycle("configuration-change")
        debugLog("lifecycle=configuration-change")
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createConfiguredWebView(): WebView =
        WebView(this).apply {
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

    private fun attachWebView(view: WebView) {
        webView = view
        installOriginScopedBridge(view)
        setContentView(view)
        view.requestFocus()
    }

    private fun replaceWebView(target: String, rendererRecovery: Boolean) {
        if (isFinishing || isDestroyed) return
        cancelFileSelection()
        if (customView != null) hideCustomView()

        val previous = webView
        (previous.parent as? ViewGroup)?.removeView(previous)
        previous.stopLoading()
        previous.removeAllViews()
        previous.destroy()

        attachWebView(createConfiguredWebView())
        rendererRecoveryPending = rendererRecovery
        mainFrameLoadFailed = false
        loadTrustedUrl(target)
    }

    private fun installOriginScopedBridge(view: WebView) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return

        WebViewCompat.addWebMessageListener(
            view,
            "AyinNativeTransport",
            setOf(BuildConfig.AYIN_ORIGIN),
        ) { sourceView, message, sourceOrigin, isMainFrame, _ ->
            if (sourceView !== webView || !isMainFrame || !isTrustedOrigin(sourceOrigin)) return@addWebMessageListener
            val data = message.data ?: return@addWebMessageListener
            handleBridgeMessage(data)
        }

        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return
        WebViewCompat.addDocumentStartJavaScript(
            view,
            nativeBridgeBootstrapScript(),
            setOf(BuildConfig.AYIN_ORIGIN),
        )
    }

    private fun nativeBridgeBootstrapScript(): String {
        val platform = JSONObject.quote(BuildConfig.SHELL_PLATFORM)
        return """
            (() => {
              const transport = window.AyinNativeTransport;
              if (!transport) return;
              const send = (payload) => transport.postMessage(JSON.stringify(payload));
              const reportNavigation = () =>
                send({ type: 'navigation', url: String(window.location.href).slice(0, 2048) });
              const wrapHistory = (name) => {
                const original = window.history[name];
                if (typeof original !== 'function') return;
                window.history[name] = function(...args) {
                  const result = original.apply(this, args);
                  reportNavigation();
                  return result;
                };
              };
              wrapHistory('pushState');
              wrapHistory('replaceState');
              window.addEventListener('popstate', reportNavigation);
              window.addEventListener('hashchange', reportNavigation);

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
              reportNavigation();
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

            "setFullscreen" ->
                runOnUiThread {
                    setFullscreen(payload.optBoolean("enabled", false))
                }

            "notifyPlaybackState" -> {
                val state = payload.optString("state").take(MAX_PLAYBACK_STATE_LENGTH)
                runOnUiThread {
                    webView.keepScreenOn = state == "playing"
                    debugLog("playback=$state")
                }
            }

            "navigation" -> {
                val url = payload.optString("url").take(MAX_EXTERNAL_URL_LENGTH)
                if (!isTrustedWebUrl(url)) return
                runOnUiThread {
                    cancelFileSelection()
                    lastTrustedUrl = url
                    debugLog("navigation=$url")
                }
            }
        }
    }

    private fun isTrustedOrigin(origin: Uri): Boolean {
        val configured = Uri.parse(BuildConfig.AYIN_ORIGIN)
        return origin.scheme == configured.scheme &&
            origin.host == configured.host &&
            normalizedPort(origin) == normalizedPort(configured)
    }

    private fun isTrustedWebUrl(raw: String): Boolean {
        val uri = runCatching { Uri.parse(raw) }.getOrNull() ?: return false
        return isTrustedOrigin(uri)
    }

    private fun normalizedPort(uri: Uri): Int =
        if (uri.port == -1 && uri.scheme == "https") 443 else uri.port

    private fun currentTrustedUrl(view: WebView = webView): String =
        view.url?.takeIf(::isTrustedWebUrl) ?: lastTrustedUrl

    private fun loadIntent(intent: Intent) {
        cancelFileSelection()
        val raw = intent.dataString
        val target = ShellNavigation.normalizeDeepLink(raw) ?: BuildConfig.AYIN_ORIGIN
        directBackArmed =
            ShellNavigation.isTvPlatform() &&
            ShellNavigation.exitOnBackRequested(raw)
        debugLog("deep-link=$target direct-back=$directBackArmed")
        loadTrustedUrl(target)
    }

    private fun loadTrustedUrl(target: String) {
        if (!isTrustedWebUrl(target)) return
        lastTrustedUrl = target
        mainFrameLoadFailed = false
        webView.loadUrl(target)
    }

    private fun handleBackPressed() {
        if (directBackArmed) {
            directBackArmed = false
            debugLog("direct-back=exit")
            finish()
            return
        }
        if (customView != null) {
            hideCustomView()
            return
        }
        dispatchCancelableRemoteKey("BACK") { consumed ->
            if (consumed || isFinishing || isDestroyed) return@dispatchCancelableRemoteKey
            when {
                webView.canGoBack() -> webView.goBack()
                else -> finish()
            }
        }
    }

    private fun emitRemoteKey(key: String) {
        if (!::webView.isInitialized) return
        val payload =
            JSONObject()
                .put("key", key)
                .put("platform", BuildConfig.SHELL_PLATFORM)
                .toString()
        webView.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('ayin:native-remote',{detail:$payload,cancelable:true}));",
            null,
        )
    }

    private fun dispatchCancelableRemoteKey(key: String, callback: (Boolean) -> Unit) {
        if (!::webView.isInitialized) {
            callback(false)
            return
        }
        val payload =
            JSONObject()
                .put("key", key)
                .put("platform", BuildConfig.SHELL_PLATFORM)
                .toString()
        var completed = false
        val fallback =
            Runnable {
                if (!completed) {
                    completed = true
                    callback(false)
                }
            }
        webView.postDelayed(fallback, BACK_DISPATCH_TIMEOUT_MS)
        webView.evaluateJavascript(
            "(() => { const e = new CustomEvent('ayin:native-remote',{detail:$payload,cancelable:true}); return !window.dispatchEvent(e); })();",
        ) { result ->
            if (completed) return@evaluateJavascript
            completed = true
            webView.removeCallbacks(fallback)
            callback(result == "true")
        }
    }

    private fun emitLifecycle(state: String, level: Int? = null) {
        if (!::webView.isInitialized) return
        val payload =
            JSONObject()
                .put("state", state)
                .put("platform", BuildConfig.SHELL_PLATFORM)
                .apply {
                    if (level != null) put("level", level)
                }
                .toString()
        webView.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('ayin:native-lifecycle',{detail:$payload}));",
            null,
        )
    }

    private fun emitNetwork(online: Boolean, force: Boolean = false) {
        if (!::webView.isInitialized) return
        if (!force && lastNetworkOnline == online) return
        lastNetworkOnline = online
        val payload =
            JSONObject()
                .put("online", online)
                .put("platform", BuildConfig.SHELL_PLATFORM)
                .toString()
        webView.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('ayin:native-network',{detail:$payload}));",
            null,
        )
        debugLog("network=" + if (online) "online" else "offline")

        if (online && mainFrameLoadFailed) {
            mainFrameLoadFailed = false
            loadTrustedUrl(lastTrustedUrl)
        }
    }

    private fun publishNetworkState() {
        runOnUiThread {
            if (!isFinishing && !isDestroyed) emitNetwork(isNetworkOnline())
        }
    }

    private fun isNetworkOnline(): Boolean {
        val network = connectivityManager.activeNetwork ?: return false
        val capabilities = connectivityManager.getNetworkCapabilities(network) ?: return false
        return capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private fun registerNetworkCallback() {
        try {
            connectivityManager.registerDefaultNetworkCallback(networkCallback)
            networkCallbackRegistered = true
            emitNetwork(isNetworkOnline(), force = true)
        } catch (error: RuntimeException) {
            debugLog("network-callback=unavailable ${error.javaClass.simpleName}")
        }
    }

    private fun unregisterNetworkCallback() {
        if (!networkCallbackRegistered) return
        networkCallbackRegistered = false
        runCatching { connectivityManager.unregisterNetworkCallback(networkCallback) }
    }

    private fun mediaRemoteKey(keyCode: Int): String? =
        when (keyCode) {
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> "PLAY_PAUSE"
            KeyEvent.KEYCODE_MEDIA_PLAY -> "PLAY"
            KeyEvent.KEYCODE_MEDIA_PAUSE -> "PAUSE"
            KeyEvent.KEYCODE_MEDIA_REWIND -> "REWIND"
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> "FAST_FORWARD"
            KeyEvent.KEYCODE_MENU -> "MENU"
            else -> null
        }

    private inner class AyinWebViewClient : WebViewClient() {
        override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
            super.onPageStarted(view, url, favicon)
            if (view === webView) cancelFileSelection()
            if (isTrustedWebUrl(url)) mainFrameLoadFailed = false
        }

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (!request.isForMainFrame) return false
            val uri = request.url
            if (isTrustedOrigin(uri)) return false
            openExternalUri(uri)
            return true
        }

        override fun onPageFinished(view: WebView, url: String) {
            super.onPageFinished(view, url)
            if (!isTrustedWebUrl(url)) return
            emitNetwork(isNetworkOnline(), force = true)
            if (mainFrameLoadFailed) {
                debugLog("main-frame-failed-finished")
                return
            }
            lastTrustedUrl = currentTrustedUrl(view)
            if (rendererRecoveryPending) {
                rendererRecoveryPending = false
                emitLifecycle("renderer-recovered")
                debugLog("renderer=recovered")
            }
        }

        override fun onReceivedError(
            view: WebView,
            request: WebResourceRequest,
            error: WebResourceError,
        ) {
            super.onReceivedError(view, request, error)
            if (!request.isForMainFrame) return
            mainFrameLoadFailed = true
            debugLog("main-frame-error=${error.errorCode}")
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            if (view !== webView) return true
            val target = currentTrustedUrl(view)
            lastTrustedUrl = target
            debugLog(
                "renderer-gone crashed=${detail.didCrash()} priority=${detail.rendererPriorityAtExit()}",
            )
            runOnUiThread { replaceWebView(target, rendererRecovery = true) }
            return true
        }
    }

    private inner class AyinChromeClient : WebChromeClient() {
        override fun onShowFileChooser(
            view: WebView,
            callback: ValueCallback<Array<Uri>>,
            params: FileChooserParams,
        ): Boolean {
            val url = view.url
            val types = VideoFileSelection.acceptedTypes(params.acceptTypes)
            if (view !== webView || url == null || !isTrustedWebUrl(url) ||
                params.mode != FileChooserParams.MODE_OPEN || params.isCaptureEnabled || types.isEmpty()
            ) {
                callback.onReceiveValue(null)
                return true
            }
            val selection = VideoSelection(view, url, types, callback)
            // A canceled request keeps its slot until its system result arrives.
            // Otherwise a late result from A could satisfy a new callback B.
            if (!fileSelection.begin(selection)) {
                callback.onReceiveValue(null)
                return true
            }
            val picker = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = types.singleOrNull() ?: "video/*"
                putExtra(Intent.EXTRA_MIME_TYPES, types.toTypedArray())
                putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            try {
                videoPicker.launch(picker)
            } catch (_: RuntimeException) {
                fileSelection.launchFailed()?.callback?.onReceiveValue(null)
            }
            return true
        }

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
            setFullscreen(true)
        }

        override fun onHideCustomView() = hideCustomView()
    }

    private fun cancelFileSelection() {
        fileValidationJob?.cancel()
        fileValidationJob = null
        fileSelection.cancel()?.callback?.onReceiveValue(null)
    }

    private fun ownsFileSelection(selection: VideoSelection): Boolean =
        !isFinishing && !isDestroyed && selection.view === webView &&
            webView.url == selection.url && isTrustedWebUrl(selection.url)

    private fun hideCustomView() {
        val view = customView ?: return
        (view.parent as? ViewGroup)?.removeView(view)
        customView = null
        customViewCallback?.onCustomViewHidden()
        customViewCallback = null
        webView.visibility = View.VISIBLE
        webView.requestFocus()
        setFullscreen(false)
    }

    private fun openExternalUri(uri: Uri) {
        if (uri.scheme !in setOf("https", "http", "mailto", "tel")) return
        runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
    }

    private fun setFullscreen(enabled: Boolean) {
        shellFullscreen = enabled
        WindowCompat.setDecorFitsSystemWindows(window, !enabled)
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        if (enabled) {
            controller.systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            controller.hide(WindowInsetsCompat.Type.systemBars())
        } else {
            controller.show(WindowInsetsCompat.Type.systemBars())
        }
        debugLog("fullscreen=$enabled")
    }

    internal fun loadTestHtmlForTests(html: String) {
        check(BuildConfig.DEBUG)
        webView.loadDataWithBaseURL(
            BuildConfig.AYIN_ORIGIN,
            html,
            "text/html",
            "UTF-8",
            null,
        )
    }

    internal fun simulateRendererRecoveryForTests() {
        check(BuildConfig.DEBUG)
        val target = currentTrustedUrl()
        lastTrustedUrl = target
        replaceWebView(target, rendererRecovery = true)
    }

    internal fun emitNetworkForTests(online: Boolean) {
        check(BuildConfig.DEBUG)
        emitNetwork(online, force = true)
    }

    internal fun shellFullscreenForTests(): Boolean = shellFullscreen

    internal fun lastTrustedUrlForTests(): String = lastTrustedUrl

    internal fun currentTrustedUrlForTests(): String = currentTrustedUrl()

    private fun debugLog(message: String) {
        if (BuildConfig.DEBUG) Log.i(TAG, message)
    }

    companion object {
        private const val TAG = "AyinShell"
        private const val MAX_BRIDGE_MESSAGE_LENGTH = 4096
        private const val MAX_EXTERNAL_URL_LENGTH = 2048
        private const val MAX_PLAYBACK_STATE_LENGTH = 64
        private const val BACK_DISPATCH_TIMEOUT_MS = 250L
        private const val STATE_LAST_TRUSTED_URL = "ayin.lastTrustedUrl"
        private const val STATE_DIRECT_BACK_ARMED = "ayin.directBackArmed"

        private val DPAD_KEY_CODES =
            setOf(
                KeyEvent.KEYCODE_DPAD_UP,
                KeyEvent.KEYCODE_DPAD_DOWN,
                KeyEvent.KEYCODE_DPAD_LEFT,
                KeyEvent.KEYCODE_DPAD_RIGHT,
                KeyEvent.KEYCODE_DPAD_CENTER,
                KeyEvent.KEYCODE_ENTER,
            )
    }
}
