# Keep the JavaScript bridge methods that WebView calls by name.
-keepclassmembers class net.ayin.shell.MainActivity$AyinJavascriptBridge {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep BuildConfig fields used to parameterize shell flavors.
-keep class net.ayin.shell.BuildConfig { *; }
