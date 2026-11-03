plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
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
        // Adresse der Cloud-Variante; die App ist ein Client dafür
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
    packaging {
        resources {
            excludes += setOf(
                "META-INF/INDEX.LIST",
                "META-INF/io.netty.versions.properties",
                "META-INF/DEPENDENCIES",
                "META-INF/LICENSE",
                "META-INF/LICENSE.txt",
                "META-INF/NOTICE",
                "META-INF/NOTICE.txt",
                "META-INF/versions/9/previous-compilation-data.bin",
            )
        }
    }
}

ksp {
    arg("room.generateKotlin", "true")
    arg("room.schemaLocation", "$projectDir/schemas")
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.service)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    debugImplementation(libs.androidx.compose.ui.tooling)

    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)

    implementation(libs.ktor.server.core)
    implementation(libs.ktor.server.cio)
    implementation(libs.ktor.server.websockets)
    implementation(libs.ktor.server.content.negotiation)
    implementation(libs.ktor.server.status.pages)
    implementation(libs.ktor.serialization.json)
    implementation(libs.ktor.client.core)
    implementation(libs.ktor.client.okhttp) // Plattform-TLS statt Ktor-CIO: zuverlässiger auf Android

    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.zxing.core)
    implementation(libs.jcifs.ng) // SMB-Client zum Durchsuchen von Windows-Freigaben
    testImplementation("junit:junit:4.13.2")
}
