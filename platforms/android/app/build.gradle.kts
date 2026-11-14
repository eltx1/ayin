import com.google.firebase.crashlytics.buildtools.gradle.CrashlyticsExtension
import com.google.gms.googleservices.GoogleServicesTask

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

fun setting(name: String, fallback: String = ""): String =
    providers.gradleProperty(name).orElse(providers.environmentVariable(name)).getOrElse(fallback)
fun quoted(value: String): String = "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

val firebaseConfigured = setting("AYIN_FIREBASE_ANDROID_APP_ID").isNotBlank()
if (firebaseConfigured) {
    // Real downloaded client config only. No placeholder Firebase project is generated.
    val configFile = file(setting("AYIN_FIREBASE_CONFIG_FILE", "src/mobile/google-services.json"))
    require(configFile.isFile) { "Set AYIN_FIREBASE_CONFIG_FILE to the actual Firebase Android client JSON" }
    apply(plugin = "com.google.gms.google-services")
    apply(plugin = "com.google.firebase.crashlytics")
    tasks.withType<GoogleServicesTask>().configureEach {
        if (name.contains("Mobile")) googleServicesJsonFiles.set(listOf(configFile)) else enabled = false
    }
    tasks.configureEach {
        if (name.contains("Crashlytics") && !name.contains("Mobile")) enabled = false
    }
}


android {
    namespace = "net.ayin.shell"
    compileSdk = 36

    defaultConfig {
        applicationId = "net.ayin.app"
        minSdk = 26
        targetSdk = 36
        versionCode = setting("AYIN_VERSION_CODE", "2").toInt()
        versionName = setting("AYIN_VERSION_NAME", "1.1.0")
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "AYIN_ORIGIN", "\"https://ayin.stream\"")
        buildConfigField("String", "SHELL_PLATFORM", "\"android\"")
    }

    flavorDimensions += "surface"
    productFlavors {
        create("mobile") {
            dimension = "surface"
            applicationIdSuffix = ".mobile"
            buildConfigField("String", "SHELL_PLATFORM", "\"android\"")
            if (!firebaseConfigured) {
                resValue("string", "google_app_id", "")
                resValue("string", "google_api_key", "")
                resValue("string", "project_id", "")
                resValue("string", "gcm_defaultSenderId", "")
            }
        }
        create("tv") {
            dimension = "surface"
            applicationIdSuffix = ".tv"
            buildConfigField("String", "SHELL_PLATFORM", "\"google-tv\"")
        }
        create("fireTv") {
            dimension = "surface"
            applicationIdSuffix = ".firetv"
            buildConfigField("String", "SHELL_PLATFORM", "\"fire-tv\"")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    testOptions {
        animationsDisabled = true
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
            val appId = "ca-app-pub-3940256099942544~3347511713"
            manifestPlaceholders["ayinAdMobAppId"] = appId
            buildConfigField("String", "ADMOB_APP_ID", quoted(appId))
        }
        release {
            isMinifyEnabled = true
            val appId = setting("AYIN_ADMOB_ANDROID_APP_ID")
            require(appId.isEmpty() || Regex("ca-app-pub-[0-9]{16}~[0-9]{10}").matches(appId)) { "Invalid AYIN_ADMOB_ANDROID_APP_ID" }
            // Unconfigured CI validation only: provider receives Google's documented sample ID.
            // BuildConfig remains empty, capabilities/requests are disabled, release publication gate rejects it.
            manifestPlaceholders["ayinAdMobAppId"] = appId.ifEmpty { "ca-app-pub-3940256099942544~3347511713" }
            buildConfigField("String", "ADMOB_APP_ID", quoted(appId))
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    // Mobile only. Google Play services must never become a Fire TV dependency.
    "mobileImplementation"("com.google.android.gms:play-services-ads:25.5.0")
    "mobileImplementation"("com.google.android.ump:user-messaging-platform:4.0.0")
    "mobileImplementation"(platform("com.google.firebase:firebase-bom:34.19.0"))
    "mobileImplementation"("com.google.firebase:firebase-analytics")
    "mobileImplementation"("com.google.firebase:firebase-messaging")
    "mobileImplementation"("com.google.firebase:firebase-crashlytics")

    implementation("androidx.activity:activity-ktx:1.13.0")
    implementation("androidx.appcompat:appcompat:1.8.0")
    implementation("androidx.webkit:webkit:1.15.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20250517")
    androidTestImplementation("androidx.test:core-ktx:1.7.0")
    androidTestImplementation("androidx.test.ext:junit-ktx:1.3.0")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.7.0")
}

// CI resolves and records locks; production release requires reviewed committed lock state.
dependencyLocking { lockAllConfigurations() }

if (firebaseConfigured) {
    android.buildTypes.configureEach {
        val releaseBuild = name == "release"
        configure<CrashlyticsExtension> {
            mappingFileUploadEnabled = releaseBuild && setting("AYIN_CRASHLYTICS_UPLOAD_MAPPING", "false") == "true"
            nativeSymbolUploadEnabled = false // Kotlin/Java shell; no app-owned NDK library.
        }
    }
}
