package net.ayin.shell

import android.widget.FrameLayout
import org.json.JSONObject

internal object MobileRuntimeFactory {
    fun create(activity: MainActivity, bannerHost: FrameLayout, emit: (JSONObject) -> Unit): MobileRuntime = UnsupportedMobileRuntime()
}
