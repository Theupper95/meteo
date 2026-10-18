plugins {
    id("com.android.application")
}

// Versione e numero di build arrivano dal workflow (gradle -PappVersion=3.0.0 -PbuildNumber=12).
val appVersion = (findProperty("appVersion") as String?) ?: "3.0.0"
val buildNumber = ((findProperty("buildNumber") as String?) ?: "1").toInt()

android {
    namespace = "io.github.theupper95.isobara"
    compileSdk = 35

    defaultConfig {
        applicationId = "io.github.theupper95.isobara"
        minSdk = 26
        targetSdk = 35
        versionCode = 100 + buildNumber
        versionName = appVersion
    }

    // Chiave di firma pubblica, nel repository: serve solo perché ogni nuova versione
    // si installi sopra la precedente. Non protegge nulla: scarica l'APK solo dalle Release.
    signingConfigs {
        create("isobara") {
            storeFile = rootProject.file("isobara.keystore")
            storePassword = "isobara-pubblica"
            keyAlias = "isobara"
            keyPassword = "isobara-pubblica"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("isobara")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }
}
