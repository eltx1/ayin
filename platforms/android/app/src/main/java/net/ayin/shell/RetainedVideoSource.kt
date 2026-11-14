package net.ayin.shell

import android.content.Context
import android.content.Intent
import android.net.Uri

/** One explicitly selected read grant. Never a raw path or file bytes crossing JS. */
internal class RetainedVideoSource(private val context: Context) {
    private val prefs = context.getSharedPreferences("ayin_selected_video_v1", Context.MODE_PRIVATE)

    fun remember(uri: Uri, offeredFlags: Int) {
        if (!VideoSourcePolicy.contentUri(uri.toString()) ||
            offeredFlags and Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION == 0 ||
            offeredFlags and Intent.FLAG_GRANT_READ_URI_PERMISSION == 0) return
        try {
            context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        } catch (_: RuntimeException) { return }
        val previous = prefs.getString("uri", null)
        prefs.edit().putString("uri", uri.toString()).putLong("selectedAt", System.currentTimeMillis()).apply()
        if (previous != null && previous != uri.toString()) release(Uri.parse(previous))
    }

    fun restored(): Uri? {
        val raw = prefs.getString("uri", null) ?: return null
        val selectedAt = prefs.getLong("selectedAt", 0)
        if (!VideoSourcePolicy.fresh(selectedAt, System.currentTimeMillis()) || !VideoSourcePolicy.contentUri(raw)) {
            clear(); return null
        }
        val uri = Uri.parse(raw)
        if (!runCatching { context.contentResolver.persistedUriPermissions.any { it.uri == uri && it.isReadPermission } }.getOrDefault(false)) {
            clear(); return null
        }
        return uri
    }

    fun clear() {
        val raw = prefs.getString("uri", null)
        prefs.edit().clear().apply()
        if (raw != null && VideoSourcePolicy.contentUri(raw)) release(Uri.parse(raw))
    }

    private fun release(uri: Uri) {
        try { context.contentResolver.releasePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) }
        catch (_: RuntimeException) { /* Provider already revoked/deleted the grant. */ }
    }
}

internal object VideoSourcePolicy {
    private const val lifetimeMs = 7L * 24 * 60 * 60 * 1000
    fun fresh(selectedAt: Long, now: Long): Boolean = selectedAt > 0 && now >= selectedAt && now - selectedAt <= lifetimeMs
    fun contentUri(raw: String): Boolean = raw.length <= 4096 && runCatching {
        val uri = java.net.URI(raw)
        uri.scheme == "content" && !uri.rawAuthority.isNullOrEmpty() && uri.userInfo == null && uri.fragment == null
    }.getOrDefault(false)
    fun publicShareUrl(raw: String): Boolean = raw.length <= 2048 && runCatching {
        val uri = java.net.URI(raw)
        val query = uri.rawQuery
        val fields = query?.split('&') ?: emptyList()
        val permittedQuery = query == null || (fields.size in 1..2 &&
            fields.all { it in setOf("kids=1", "lang=en", "lang=ar") } &&
            fields.map { it.substringBefore('=') }.distinct().size == fields.size)
        uri.scheme == "https" && uri.host == "ayin.stream" && (uri.port == -1 || uri.port == 443) &&
            uri.userInfo == null && uri.rawFragment == null && permittedQuery &&
            uri.normalize().rawPath == uri.rawPath &&
            uri.rawPath.matches(Regex("/(?:en/|ar/)?(?:clips|(?:watch|c|live|playlists)/[A-Za-z0-9_.~-]{1,200})"))
    }.getOrDefault(false)
}
