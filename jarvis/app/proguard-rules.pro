# Мінімізацію (R8) у build.gradle.kts вимкнено, тому цей файл зараз не використовується.
# Якщо колись увімкнете isMinifyEnabled = true, ці правила збережуть класи,
# з якими бібліотеки працюють через рефлексію.
-keep class org.vosk.** { *; }
-keep class com.sun.jna.** { *; }
-keep class com.anthropic.** { *; }
-keep class com.fasterxml.jackson.** { *; }
-keep class kotlin.Metadata { *; }
-dontwarn com.sun.jna.**
-dontwarn java.awt.**
-dontwarn javax.annotation.**
-dontwarn org.slf4j.**
