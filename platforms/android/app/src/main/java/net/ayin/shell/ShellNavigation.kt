package net.ayin.shell

import java.net.URI

internal object ShellNavigation {
    fun normalizeDeepLink(
        raw: String?,
        origin: String = BuildConfig.AYIN_ORIGIN,
        canonicalHost: String = AYIN_HOST,
    ): String? {
        if (raw.isNullOrBlank()) return null
        val uri = runCatching { URI(raw) }.getOrNull() ?: return null
        val scheme = uri.scheme?.lowercase() ?: return null

        if (scheme == "https") {
            if (!uri.host.equals(canonicalHost, ignoreCase = true)) return null
            if (uri.port !in listOf(-1, 443)) return null
            return raw
        }

        if (scheme != "ayin") return null
        val host = uri.host?.trim('/') ?: return origin
        val route = ("/" + host + (uri.rawPath ?: "")).replace(Regex("/{2,}"), "/")
        return buildString {
            append(origin.trimEnd('/'))
            append(route)
            if (!uri.rawQuery.isNullOrBlank()) append('?').append(uri.rawQuery)
            if (!uri.rawFragment.isNullOrBlank()) append('#').append(uri.rawFragment)
        }
    }

    fun exitOnBackRequested(raw: String?): Boolean {
        if (raw.isNullOrBlank()) return false
        val uri = runCatching { URI(raw) }.getOrNull() ?: return false
        val query = uri.rawQuery ?: return false
        return query
            .split('&')
            .mapNotNull { pair ->
                val separator = pair.indexOf('=')
                if (separator < 0) pair to "" else pair.substring(0, separator) to pair.substring(separator + 1)
            }
            .any { (key, value) -> key == "exit_on_back" && value.equals("true", ignoreCase = true) }
    }

    fun isTvPlatform(platform: String = BuildConfig.SHELL_PLATFORM): Boolean =
        platform == "android-tv" || platform == "google-tv" || platform == "fire-tv"

    private const val AYIN_HOST = "ayin.stream"
}
