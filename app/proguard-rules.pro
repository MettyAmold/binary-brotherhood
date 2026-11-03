# Ktor / kotlinx.serialization
-keepattributes *Annotation*, InnerClasses
-dontwarn org.slf4j.**
-dontwarn io.ktor.**
-keep class at.binarybrotherhood.app.server.** { *; }
-keepclassmembers class kotlinx.serialization.json.** { *** Companion; }
-keepclasseswithmembers class kotlinx.serialization.json.** { kotlinx.serialization.KSerializer serializer(...); }
-keep,includedescriptorclasses class at.binarybrotherhood.app.**$$serializer { *; }
-keepclassmembers class at.binarybrotherhood.app.** { *** Companion; }
-keepclasseswithmembers class at.binarybrotherhood.app.** { kotlinx.serialization.KSerializer serializer(...); }
