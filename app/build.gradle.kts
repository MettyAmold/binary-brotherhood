plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "at.binarybrotherhood.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "at.binarybrotherhood.app"
        minSdk = 26
        targetSdk = 35
        versionCode = (System.getenv("BBL_VERSION_CODE") ?: "2").toInt()
        versionName = System.getenv("BBL_VERSION_NAME") ?: "1.0"
        // Die App zeigt diese Adresse im WebView
        buildConfigField("String", "CLOUD_URL", "\"${System.getenv("BBL_CLOUD_URL") ?: "https://binary-brotherhood.binary-brotherhood-cloud.workers.dev"}\"")
        vectorDrawables { useSupportLibrary = true }
    }

    // Release-Signatur: Keystore-Pfad und Passwörter kommen aus Umgebungsvariablen
    // (lokal aus ~/.config/bbl/release.env, in GitHub Actions aus den Repository-Secrets).
    // Fehlen sie, wird mit dem Debug-Key signiert, damit der Build nie scheitert.
    val keystorePath = System.getenv("BBL_KEYSTORE_PATH")
    val hasReleaseKey = keystorePath != null && file(keystorePath).exists()
    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                storeFile = file(keystorePath!!)
                storePassword = System.getenv("BBL_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("BBL_KEY_ALIAS") ?: "bbl"
                keyPassword = System.getenv("BBL_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = if (hasReleaseKey) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    debugImplementation(libs.androidx.compose.ui.tooling)

    // Update-Prüfung gegen GitHub-Releases
    implementation(libs.ktor.client.core)
    implementation(libs.ktor.client.okhttp)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
}
