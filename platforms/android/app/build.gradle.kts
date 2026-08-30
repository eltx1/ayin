plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "net.ayin.shell"
    compileSdk = 36

    defaultConfig {
        applicationId = "net.ayin.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"
        buildConfigField("String", "AYIN_ORIGIN", "\"https://ayin.stream\"")
        buildConfigField("String", "SHELL_PLATFORM", "\"android\"")
    }

    flavorDimensions += "surface"
    productFlavors {
        create("mobile") {
            dimension = "surface"
            applicationIdSuffix = ".mobile"
            buildConfigField("String", "SHELL_PLATFORM", "\"android\"")
            manifestPlaceholders["isTv"] = "false"
            manifestPlaceholders["leanbackRequired"] = "false"
        }
        create("tv") {
            dimension = "surface"
            applicationIdSuffix = ".tv"
            buildConfigField("String", "SHELL_PLATFORM", "\"google-tv\"")
            manifestPlaceholders["isTv"] = "true"
            manifestPlaceholders["leanbackRequired"] = "true"
        }
        create("fireTv") {
            dimension = "surface"
            applicationIdSuffix = ".firetv"
            buildConfigField("String", "SHELL_PLATFORM", "\"fire-tv\"")
            manifestPlaceholders["isTv"] = "true"
            manifestPlaceholders["leanbackRequired"] = "true"
        }
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = true
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
