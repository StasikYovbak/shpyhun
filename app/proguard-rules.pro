# kotlinx.serialization
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class com.stasik.worktime.** {
    *** Companion;
}
-keepclasseswithmembers class com.stasik.worktime.** {
    kotlinx.serialization.KSerializer serializer(...);
}
