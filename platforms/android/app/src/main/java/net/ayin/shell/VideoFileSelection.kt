package net.ayin.shell

/** One system result owns one WebView callback, even after its document leaves. */
internal class FileSelectionLease<T> {
    private var active: T? = null
    private var inFlight = false

    fun begin(value: T): Boolean {
        if (inFlight || active != null) return false
        active = value
        inFlight = true
        return true
    }

    fun cancel(): T? = active.also { active = null }

    fun receiveResult(): T? = active.also {
        inFlight = false
    }

    fun completeValidation(value: T): T? {
        if (inFlight || active !== value) return null
        return cancel()
    }

    fun launchFailed(): T? {
        inFlight = false
        return cancel()
    }
}

internal object VideoFileSelection {
    private val extensions = mapOf(
        ".mp4" to "video/mp4", ".m4v" to "video/x-m4v",
        ".mov" to "video/quicktime", ".webm" to "video/webm",
        ".mkv" to "video/x-matroska", ".avi" to "video/x-msvideo",
        ".mpeg" to "video/mpeg", ".mpg" to "video/mpeg",
        ".mts" to "video/mp2t", ".m2ts" to "video/mp2t", ".ts" to "video/mp2t",
        ".3gp" to "video/3gpp", ".3g2" to "video/3gpp2",
        ".wmv" to "video/x-ms-wmv", ".flv" to "video/x-flv",
        ".ogv" to "video/ogg", ".mxf" to "video/mxf",
    )

    fun acceptedTypes(raw: Array<String>): List<String> {
        val types = raw.flatMap { it.split(',') }.map { it.trim().lowercase() }
        if ("video/*" in types) return listOf("video/*")
        return types.mapNotNull { value ->
            when {
                value.matches(Regex("video/[a-z0-9.+-]+")) -> value
                else -> extensions[value]
            }
        }.distinct().take(24)
    }

    fun accepts(mimeType: String?, requested: List<String>): Boolean {
        val mime = mimeType?.lowercase() ?: return false
        return mime.startsWith("video/") && ("video/*" in requested || mime in requested)
    }
}
