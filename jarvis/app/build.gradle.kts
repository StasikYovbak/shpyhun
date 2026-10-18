plugins {
    // Android Gradle Plugin 9 уже має вбудовану підтримку Kotlin —
    // окремий плагін org.jetbrains.kotlin.android підключати НЕ треба.
    id("com.android.application")
}

android {
    namespace = "ua.jarvis.assistant"
    compileSdk = 36

    defaultConfig {
        applicationId = "ua.jarvis.assistant"
        minSdk = 29
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // Нативні бібліотеки Vosk для реальних телефонів (arm) і емулятора (x86_64).
        ndk {
            abiFilters += listOf("arm64-v8a", "armeabi-v7a", "x86_64")
        }
    }

    buildTypes {
        release {
            // Мінімізацію вимкнено свідомо: Claude SDK і Jackson працюють через рефлексію,
            // а R8 без тонкого налаштування їх ламає. Розмір APK від цього росте, але все працює.
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // Підписуємо release тим самим debug-ключем, щоб APK одразу ставився на телефон.
            // Для публікації в Google Play створіть власний ключ (Build → Generate Signed Bundle / APK).
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        viewBinding = true
        buildConfig = true
    }

    packaging {
        resources {
            // Однакові службові файли в різних бібліотеках (Jackson, Kotlin, OkHttp) —
            // без цього збірка падає з «2 files found with path ...».
            excludes += setOf(
                "META-INF/DEPENDENCIES",
                "META-INF/INDEX.LIST",
                "META-INF/LICENSE",
                "META-INF/LICENSE.txt",
                "META-INF/LICENSE.md",
                "META-INF/NOTICE",
                "META-INF/NOTICE.txt",
                "META-INF/NOTICE.md",
                "META-INF/*.SF",
                "META-INF/*.DSA",
                "META-INF/*.RSA",
                "META-INF/versions/9/module-info.class",
                "META-INF/versions/9/OSGI-INF/MANIFEST.MF",
            )
        }
        // Стискаємо код і нативні бібліотеки всередині APK: файл виходить у ~2,5 раза менший
        // (зручно пересилати на телефон), а Android розпакує їх під час встановлення.
        jniLibs {
            useLegacyPackaging = true
        }
        dex {
            useLegacyPackaging = true
        }
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

dependencies {
    // Базові бібліотеки Android
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("com.google.android.material:material:1.13.0")
    implementation("androidx.constraintlayout:constraintlayout:2.2.1")
    implementation("androidx.recyclerview:recyclerview:1.4.0")
    implementation("androidx.lifecycle:lifecycle-service:2.9.4")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.9.4")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")

    // Зашифроване сховище для API-ключів (EncryptedSharedPreferences)
    implementation("androidx.security:security-crypto:1.1.0")

    // Офлайн-розпізнавання мови Vosk (+ JNA, через яку Vosk викликає нативний код)
    implementation("com.alphacephei:vosk-android:0.3.75")
    implementation("net.java.dev.jna:jna:5.18.1@aar")

    // Офіційний Claude SDK (Java, працює з Kotlin). Тягне за собою OkHttp — ним же
    // качаємо модель Vosk і ходимо в YouTube Data API.
    implementation("com.anthropic:anthropic-java:2.69.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    // Unit-тести розбору команд (запускаються на комп'ютері, без телефона)
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20260522")
}
