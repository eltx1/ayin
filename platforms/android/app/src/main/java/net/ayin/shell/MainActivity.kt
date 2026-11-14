package net.ayin.shell

import android.annotation.SuppressLint
import android.app.PictureInPictureParams
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.util.Rational
import android.content.ComponentCallbacks2
import android.content.BroadcastReceiver
import android.content.IntentFilter
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
import android.widget.LinearLayout
import android.widget.FrameLayout
import android.widget.Button
import android.widget.TextView
import android.view.Gravity
import android.webkit.WebResourceResponse
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
import androidx.appcompat.app.AlertDialog
import androidx.core.view.ViewCompat
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.Lifecycle
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

class MainActivity : AppCompatActivity() {
    internal lateinit var webView: WebView
    private lateinit var mobileRuntime: MobileRuntime
    private lateinit var bannerHost: FrameLayout
    private lateinit var offlineView: LinearLayout
    private var documentGeneration = 0L
    private val pendingMobileRequests = mutableSetOf<String>()
    private val completedMobileRequests = ArrayDeque<String>()
    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null
    private var lastTrustedUrl = BuildConfig.AYIN_ORIGIN
    private var mainFrameLoadFailed = false
    private var directBackArmed = false
    private var rendererRecoveryPending = false
    private var shellFullscreen = false
    private var networkCallbackRegistered = false
    private var lastNetworkOnline: Boolean? = null
    @Volatile private var testDocument: Pair<String, String>? = null
    private data class VideoSelection(
        val view: WebView,
        val url: String,
        val types: List<String>,
        val callback: ValueCallback<Array<Uri>>,
    )
    private val fileSelection = FileSelectionLease<VideoSelection>()
    private var fileValidationJob: Job? = null
    private val retainedVideo by lazy { RetainedVideoSource(this) }
    private var incomingVideo: Uri? = null
    private var sourceDialog: AlertDialog? = null
    private var mediaPlaying = false
    private val audioManager by lazy { getSystemService(Context.AUDIO_SERVICE) as AudioManager }
    private var audioFocus: AudioFocusRequest? = null
    private var sharePresenting = false
    private var noisyReceiverRegistered = false
    private val noisyReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) {
                pauseMedia()
                abandonAudioFocus()
            }
        }
    }
    private val videoPicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        mobileRuntime.sensitive(false)
        val clip = result.data?.clipData
        val uri = result.data?.data ?: clip?.takeIf { it.itemCount == 1 }?.getItemAt(0)?.uri
        val singleSelection = clip == null || (clip.itemCount == 1 && clip.getItemAt(0).uri == uri)
        val selection = fileSelection.receiveResult()
        val eligible = result.resultCode == RESULT_OK && uri != null && singleSelection &&
            VideoSourcePolicy.contentUri(uri.toString())
        if (!eligible || uri == null) {
            selection?.let { fileSelection.completeValidation(it)?.callback?.onReceiveValue(null) }
            return@registerForActivityResult
        }
        validateVideoChoice(selection, uri, result.data?.flags ?: 0)
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
        if (BuildConfig.SHELL_PLATFORM == "android") {
            ContextCompat.registerReceiver(this, noisyReceiver, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), ContextCompat.RECEIVER_NOT_EXPORTED)
            noisyReceiverRegistered = true
        }

        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() = handleBackPressed()
            },
        )

        // Instrumentation supplies its HTTPS document after launch. Do not start a
        // competing production request (including restore) in this debug-only mode.
        val fixtureMode = BuildConfig.DEBUG && intent.getBooleanExtra(TEST_FIXTURE_MODE, false)
        val restored = !fixtureMode && savedInstanceState?.let { webView.restoreState(it) } != null
        lastTrustedUrl =
            savedInstanceState?.getString(STATE_LAST_TRUSTED_URL)?.takeIf(::isTrustedWebUrl)
                ?: BuildConfig.AYIN_ORIGIN
        directBackArmed = savedInstanceState?.getBoolean(STATE_DIRECT_BACK_ARMED) ?: false

        if (!fixtureMode) {
            if (!restored || intent.action == Intent.ACTION_SEND) loadIntent(intent) else mobileRuntime.opened(intent)
        }
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
        sharePresenting = false
        webView.onResume()
        mobileRuntime.resume()
        emitLifecycle("resume")
        debugLog("lifecycle=resume")
    }

    override fun onPause() {
        mobileRuntime.pause()
        if (!isInPictureInPictureMode) {
            emitLifecycle("pause")
            if (BuildConfig.SHELL_PLATFORM == "android") { pauseMedia(); abandonAudioFocus() }
            webView.onPause()
        }
        CookieManager.getInstance().flush()
        debugLog("lifecycle=pause")
        super.onPause()
    }

    override fun onStop() {
        if (BuildConfig.SHELL_PLATFORM == "android") pauseMedia()
        abandonAudioFocus()
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
        abandonAudioFocus()
        if (noisyReceiverRegistered) {
            unregisterReceiver(noisyReceiver)
            noisyReceiverRegistered = false
        }
        if (::mobileRuntime.isInitialized) mobileRuntime.destroy()
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
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.BLACK) }
        // Target 36 enforces edge-to-edge. Reserve cutout/system/IME space for web and native ads.
        ViewCompat.setOnApplyWindowInsetsListener(root) { container, insets ->
            val safe = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime())
            container.setPadding(safe.left, safe.top, safe.right, safe.bottom)
            insets
        }
        bannerHost = FrameLayout(this)
        val stage = FrameLayout(this)
        stage.addView(view, FrameLayout.LayoutParams(-1, -1))
        offlineView = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.BLACK)
            visibility = View.GONE
            addView(TextView(this@MainActivity).apply {
                text = "AYIN\nتعذر الاتصال. تحقق من الإنترنت ثم أعد المحاولة.\nUnable to connect. Check your connection and retry."
                setTextColor(Color.WHITE)
                gravity = Gravity.CENTER
                setPadding(32, 32, 32, 32)
            })
            addView(Button(this@MainActivity).apply {
                text = "إعادة المحاولة / Retry"
                setOnClickListener { loadTrustedUrl(lastTrustedUrl) }
            })
        }
        stage.addView(offlineView, FrameLayout.LayoutParams(-1, -1))
        root.addView(stage, LinearLayout.LayoutParams(-1, 0, 1f))
        root.addView(bannerHost, LinearLayout.LayoutParams(-1, -2))
        mobileRuntime = MobileRuntimeFactory.create(this, bannerHost, ::emitMobileEvent)
        mobileRuntime.registerWebView(view)
        installOriginScopedBridge(view)
        setContentView(root)
        if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) mobileRuntime.resume()
        view.requestFocus()
    }

    private fun replaceWebView(target: String, rendererRecovery: Boolean) {
        if (isFinishing || isDestroyed) return
        cancelFileSelection()
        if (customView != null) hideCustomView()

        mobileRuntime.destroy()
        documentGeneration++
        pendingMobileRequests.clear()
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
              if (window.top !== window) return;
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
        """.trimIndent() + if (mobileRuntime.capabilities.isEmpty()) "" else "\n" + MobileBridgePolicy.bootstrap(mobileRuntime.capabilities)
    }

    private fun emitMobileEvent(event: JSONObject) {
        runOnUiThread {
            if (!isDestroyed && ::webView.isInitialized && isTrustedWebUrl(webView.url ?: "")) {
                webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('ayin:mobile-event',{detail:$event}));", null)
            }
        }
    }

    private fun handleMobileRequest(payload: JSONObject) {
        val id = payload.optString("id")
        val method = payload.optString("method")
        if (payload.opt("id") !is String || !MobileBridgePolicy.validId(id) || id in pendingMobileRequests || id in completedMobileRequests) return
        val params = payload.optJSONObject("params")
        val generation = documentGeneration
        fun send(result: JSONObject?, error: String?) {
            runOnUiThread {
                if (!pendingMobileRequests.remove(id)) return@runOnUiThread
                completedMobileRequests.addLast(id)
                if (completedMobileRequests.size > 256) completedMobileRequests.removeFirst()
                if (generation != documentGeneration || isDestroyed || !isTrustedWebUrl(webView.url ?: "")) return@runOnUiThread
                val response = JSONObject().put("id", id).put("ok", error == null)
                if (error != null) response.put("error", error) else response.put("result", result ?: JSONObject())
                webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('ayin:mobile-response',{detail:$response}));", null)
            }
        }
        if (pendingMobileRequests.size >= 16) return
        pendingMobileRequests.add(id)
        if (payload.keys().asSequence().toSet() != setOf("type", "id", "method", "params") || payload.opt("method") !is String ||
            method !in MobileBridgePolicy.methods || params == null) { send(null, "INVALID_REQUEST"); return }
        webView.postDelayed({ send(null, "TIMEOUT") }, 180_000)
        fun invokeNative() {
            if (generation != documentGeneration || isDestroyed) return
            // Session reset also runs during initial binding and transient identity failures.
            // Only explicit logout/known-account change calls upload.clear from the web.
            if (method == "session.reset" && params.length() == 0) cancelFileSelection()
            if (method == "upload.clear" && BuildConfig.SHELL_PLATFORM == "android") {
                if (params.length() != 0) { send(null, "INVALID_PARAMETERS"); return }
                cancelFileSelection()
                retainedVideo.clear()
                incomingVideo = null
                send(JSONObject().put("cleared", true), null)
                return
            }
            if (method == "share.open" && BuildConfig.SHELL_PLATFORM == "android") {
                val url = params.opt("url")
                if (params.keys().asSequence().toSet() != setOf("url") || url !is String || !VideoSourcePolicy.publicShareUrl(url)) {
                    send(null, "INVALID_PARAMETERS"); return
                }
                if (sharePresenting || !lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED) || !hasWindowFocus()) {
                    send(null, "BUSY"); return
                }
                try {
                    sharePresenting = true
                    startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                        type = "text/plain"; putExtra(Intent.EXTRA_TEXT, url)
                    }, getString(R.string.ayin_share)))
                    send(JSONObject().put("shared", true), null)
                } catch (_: RuntimeException) { sharePresenting = false; send(null, "SHARE_UNAVAILABLE") }
                return
            }
            if (method == "media.pip" && BuildConfig.SHELL_PLATFORM == "android") {
                if (params.length() != 0) { send(null, "INVALID_PARAMETERS"); return }
                enterVideoPip(::send); return
            }
            try { mobileRuntime.request(method, params, ::send) } catch (_: Exception) { send(null, "INVALID_PARAMETERS") }
        }
        if (method in setOf("ads.banner", "ads.interstitial", "runtime.configure")) {
            // A web IMA ad may pause content, so playing-video checks alone are insufficient.
            // Recheck the actual trusted document immediately before native ad/config dispatch.
            val script = """
                (() => document.documentElement.dataset.ayinUploadActive === 'true' ||
                  document.documentElement.dataset.ayinWebAdActive === 'true' ||
                  Array.from(document.querySelectorAll('video,audio')).some(m => !m.paused && !m.ended))()
            """.trimIndent()
            try {
                webView.evaluateJavascript(script) { busy ->
                    if (generation != documentGeneration || isDestroyed) return@evaluateJavascript
                    if (busy == "false") invokeNative() else send(null, "SENSITIVE_OPERATION")
                }
            } catch (_: RuntimeException) { send(null, "SENSITIVE_OPERATION") }
        } else invokeNative()
    }

    private fun handleBridgeMessage(raw: String) {
        if (raw.length > MAX_BRIDGE_MESSAGE_LENGTH) return
        val payload = runCatching { JSONObject(raw) }.getOrNull() ?: return
        when (payload.optString("type")) {
            "mobile" -> runOnUiThread { handleMobileRequest(payload) }
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
                    mediaPlaying = state == "playing"
                    if (mediaPlaying) requestAudioFocus() else abandonAudioFocus()
                    mobileRuntime.playback(state == "playing")
                    debugLog("playback=$state")
                }
            }

            "navigation" -> {
                val url = payload.optString("url").take(MAX_EXTERNAL_URL_LENGTH)
                if (!isTrustedWebUrl(url)) return
                runOnUiThread {
                    cancelFileSelection()
                    lastTrustedUrl = url
                    mobileRuntime.navigation()
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
        if (BuildConfig.SHELL_PLATFORM == "android" && intent.action == Intent.ACTION_SEND) {
            val stream = runCatching {
                if (android.os.Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
                else @Suppress("DEPRECATION") intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
            }.getOrNull()
            val singleStream = runCatching { intent.clipData == null ||
                (intent.clipData!!.itemCount == 1 && intent.clipData!!.getItemAt(0).uri == stream) }.getOrDefault(false)
            if (stream != null && singleStream && intent.type?.startsWith("video/") == true &&
                intent.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0 && VideoSourcePolicy.contentUri(stream.toString())) {
                incomingVideo = stream
                loadTrustedUrl(BuildConfig.AYIN_ORIGIN + "/upload")
                return
            }
        }
        val raw = intent.dataString
        val target = ShellNavigation.normalizeDeepLink(raw) ?: BuildConfig.AYIN_ORIGIN
        directBackArmed =
            ShellNavigation.isTvPlatform() &&
            ShellNavigation.exitOnBackRequested(raw)
        debugLog("deep-link=$target direct-back=$directBackArmed")
        loadTrustedUrl(target)
        mobileRuntime.opened(intent)
    }

    private fun loadTrustedUrl(target: String) {
        if (!isTrustedWebUrl(target)) return
        lastTrustedUrl = target
        mainFrameLoadFailed = false
        offlineView.visibility = View.GONE
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
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            if (BuildConfig.DEBUG && request.isForMainFrame && request.method == "GET" && isTrustedOrigin(request.url)) {
                val fixture = testDocument
                if (fixture != null && request.url.toString() == fixture.first) {
                    return WebResourceResponse(
                        "text/html", "UTF-8", 200, "OK", mapOf("Cache-Control" to "no-store"),
                        fixture.second.byteInputStream(Charsets.UTF_8),
                    )
                }
            }
            return super.shouldInterceptRequest(view, request)
        }

        override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
            super.onPageStarted(view, url, favicon)
            if (view === webView) {
                cancelFileSelection()
                documentGeneration++
                pendingMobileRequests.clear()
                completedMobileRequests.clear()
                mobileRuntime.navigation()
            }
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
            offlineView.visibility = View.GONE
            if (lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) mobileRuntime.resume()
            mobileRuntime.pageReady()
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
            offlineView.visibility = View.VISIBLE
            mobileRuntime.pause()
        }

        override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) {
            if (request.isForMainFrame && errorResponse.statusCode >= 500) {
                mainFrameLoadFailed = true
                offlineView.visibility = View.VISIBLE
                mobileRuntime.pause()
            }
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
            chooseVideoSource(selection)
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
        sourceDialog?.dismiss()
        sourceDialog = null
        fileValidationJob?.cancel()
        fileValidationJob = null
        fileSelection.cancel()?.callback?.onReceiveValue(null)
    }

    private fun chooseVideoSource(selection: VideoSelection) {
        val previous = if (BuildConfig.SHELL_PLATFORM == "android") incomingVideo ?: retainedVideo.restored() else null
        if (previous == null) { launchVideoPicker(selection); return }
        var chosen = false
        val isShared = incomingVideo != null
        sourceDialog = AlertDialog.Builder(this)
            .setTitle(R.string.ayin_choose_upload_video)
            .setItems(arrayOf(getString(if (isShared) R.string.ayin_use_shared_video else R.string.ayin_use_previous_video), getString(R.string.ayin_choose_another_video), getString(R.string.ayin_forget_previous_video))) { _, which ->
                chosen = true
                when (which) {
                    0 -> {
                        incomingVideo = null
                        val current = fileSelection.receiveResult()
                        mobileRuntime.sensitive(false)
                        if (current != null) validateVideoChoice(current, previous, 0)
                    }
                    1 -> launchVideoPicker(selection)
                    else -> { incomingVideo = null; retainedVideo.clear(); launchVideoPicker(selection) }
                }
            }
            .setNegativeButton(android.R.string.cancel, null)
            .create().also { dialog ->
                dialog.setOnDismissListener {
                    sourceDialog = null
                    if (!chosen) {
                        mobileRuntime.sensitive(false)
                        fileSelection.launchFailed()?.callback?.onReceiveValue(null)
                    }
                }
                mobileRuntime.sensitive(true)
                dialog.show()
            }
    }

    private fun launchVideoPicker(selection: VideoSelection) {
        if (!ownsFileSelection(selection)) {
            fileSelection.launchFailed()?.callback?.onReceiveValue(null); return
        }
        val picker = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = selection.types.singleOrNull() ?: "video/*"
            putExtra(Intent.EXTRA_MIME_TYPES, selection.types.toTypedArray())
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        }
        try {
            mobileRuntime.sensitive(true)
            videoPicker.launch(picker)
        } catch (_: RuntimeException) {
            mobileRuntime.sensitive(false)
            fileSelection.launchFailed()?.callback?.onReceiveValue(null)
        }
    }

    private fun validateVideoChoice(selection: VideoSelection?, uri: Uri, offeredFlags: Int) {
        if (selection != null && !ownsFileSelection(selection)) {
            fileSelection.completeValidation(selection)?.callback?.onReceiveValue(null); return
        }
        fileValidationJob = lifecycleScope.launch {
            val readable = withContext(Dispatchers.IO) {
                runCatching {
                    VideoFileSelection.accepts(contentResolver.getType(uri), selection?.types ?: listOf("video/*")) &&
                        contentResolver.openFileDescriptor(uri, "r")?.use { true } == true
                }.getOrDefault(false)
            }
            // Source recovery does not bypass account/session or web file-fingerprint checks.
            if (selection == null) {
                return@launch
            }
            val current = fileSelection.completeValidation(selection) ?: return@launch
            val permitted = readable && ownsFileSelection(current)
            if (permitted && BuildConfig.SHELL_PLATFORM == "android") retainedVideo.remember(uri, offeredFlags)
            else if (!readable && retainedVideo.restored() == uri) retainedVideo.clear()
            current.callback.onReceiveValue(if (permitted) arrayOf(uri) else null)
        }
    }

    private fun pauseMedia() {
        if (::webView.isInitialized && isTrustedWebUrl(webView.url ?: ""))
            webView.evaluateJavascript("document.querySelectorAll('video,audio').forEach(m => m.pause());", null)
        mediaPlaying = false
        if (::mobileRuntime.isInitialized) mobileRuntime.playback(false)
        if (::webView.isInitialized) webView.keepScreenOn = false
    }

    private fun requestAudioFocus() {
        if (BuildConfig.SHELL_PLATFORM != "android" || audioFocus != null) return
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MOVIE).build())
            .setOnAudioFocusChangeListener { change ->
                if (change < 0) runOnUiThread { pauseMedia(); abandonAudioFocus() }
            }.build()
        if (audioManager.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) audioFocus = request
        else pauseMedia()
    }

    private fun abandonAudioFocus() {
        audioFocus?.let { audioManager.abandonAudioFocusRequest(it) }
        audioFocus = null
    }

    private fun enterVideoPip(done: (JSONObject?, String?) -> Unit) {
        if (customView == null || !mediaPlaying || !lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED) || !packageManager.hasSystemFeature(android.content.pm.PackageManager.FEATURE_PICTURE_IN_PICTURE)) {
            done(null, "PIP_UNAVAILABLE"); return
        }
        val generation = documentGeneration
        webView.evaluateJavascript("""
            (() => {
              const video = Array.from(document.querySelectorAll('video')).find(v => !v.paused && !v.ended);
              return {busy: document.documentElement.dataset.ayinWebAdActive === 'true' ||
                document.documentElement.dataset.ayinUploadActive === 'true' || !video,
                width: video?.videoWidth || 16, height: video?.videoHeight || 9};
            })()
        """.trimIndent()) { raw ->
            if (generation != documentGeneration || isDestroyed) return@evaluateJavascript
            val media = runCatching { JSONObject(raw) }.getOrNull()
            if (media == null || media.optBoolean("busy", true)) { done(null, "SENSITIVE_OPERATION"); return@evaluateJavascript }
            try {
                mobileRuntime.pause() // PiP is content-only; native ads cannot remain visible.
                val width = media.optInt("width", 16).coerceIn(1, 8192)
                val height = media.optInt("height", 9).coerceIn(1, 8192)
                val ratio = if (width.toDouble() / height in (1.0 / 2.39)..2.39) Rational(width, height) else Rational(16, 9)
                val entered = enterPictureInPictureMode(PictureInPictureParams.Builder().setAspectRatio(ratio).build())
                if (!entered) mobileRuntime.resume()
                done(JSONObject().put("entered", entered), null)
            } catch (_: RuntimeException) { mobileRuntime.resume(); done(null, "PIP_UNAVAILABLE") }
        }
    }

    override fun onPictureInPictureModeChanged(inPip: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(inPip, newConfig)
        if (!inPip && lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
            webView.onResume()
            mobileRuntime.resume()
        }
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

    internal fun loadTestHtmlForTests(html: String): String {
        check(BuildConfig.DEBUG)
        check(intent.getBooleanExtra(TEST_FIXTURE_MODE, false))
        val target = "${BuildConfig.AYIN_ORIGIN}/__ayin_shell_test__/${System.nanoTime()}"
        webView.stopLoading()
        testDocument = target to html
        // Exercise the production HTTPS origin boundary, never a data: document.
        webView.loadUrl(target)
        return target
    }

    internal fun simulateRendererRecoveryForTests() {
        check(BuildConfig.DEBUG)
        val target = currentTrustedUrl()
        lastTrustedUrl = target
        // Re-create the same local test document at its current SPA URL; recovery
        // must not depend on a production route or network availability.
        if (intent.getBooleanExtra(TEST_FIXTURE_MODE, false)) {
            testDocument = testDocument?.let { target to it.second }
        }
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
        internal const val TEST_FIXTURE_MODE = "net.ayin.shell.TEST_FIXTURE_MODE"
        private const val TAG = "AyinShell"
        private const val MAX_BRIDGE_MESSAGE_LENGTH = 32768
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
