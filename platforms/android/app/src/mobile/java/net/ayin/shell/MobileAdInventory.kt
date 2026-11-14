package net.ayin.shell

/** Unit identity selects the SDK inventory type; this never accepts web slot/tag URLs. */
internal object MobileAdInventory {
    private val admob = Regex("ca-app-pub-[0-9]{16}/[0-9]{10}")
    private val gam = Regex("/[0-9]{1,20}(?:/[A-Za-z0-9_.-]+)+")
    fun isValid(unit: String): Boolean = unit.isEmpty() ||
        (unit.length <= 256 && (admob.matches(unit) || gam.matches(unit)))
    fun isAdManager(unit: String): Boolean = unit.startsWith("/")

    fun resolve(unit: String, format: String, debug: Boolean, testMode: Boolean): String {
        require(isValid(unit))
        require(format == "banner" || format == "interstitial")
        if (!debug && !testMode) return unit
        // Dedicated Google test inventory, including when a production unit was configured.
        return if (isAdManager(unit)) {
            if (format == "banner") "/21775744923/example/adaptive-banner" else "/21775744923/example/interstitial"
        } else {
            if (format == "banner") "ca-app-pub-3940256099942544/6300978111" else "ca-app-pub-3940256099942544/1033173712"
        }
    }
}
