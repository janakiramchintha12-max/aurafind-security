# ProGuard & R8 Optimization Rules for AuraFind Security

# Room SQLite Database
-keepclassmembers class * extends androidx.room.RoomDatabase {
    <methods>;
}
-keep class * extends androidx.room.RoomDatabase
-keep @androidx.room.Dao interface * { *; }
-keep class * extends androidx.room.RoomDatabase
-dontwarn androidx.room.paging.**

# Retrofit & Gson Network Serialization
-keepattributes Signature, InnerClasses, EnclosingMethod
-keepattributes *Annotation*
-keep class com.findmydevice.security.data.network.** { *; }
-keep class com.findmydevice.security.data.entity.** { *; }
-keepclassmembers class * {
    @com.google.gson.annotations.SerializedName <fields>;
}

# Android KeyStore & Cryptography
-keep class java.security.** { *; }
-keep class javax.crypto.** { *; }
-keep class android.security.keystore.** { *; }

# WorkManager
-keep class * extends androidx.work.Worker { *; }
-keep class * extends androidx.work.ListenableWorker { *; }

# Strip Android Debug Logging in Release Builds
-assumenosideeffects class android.util.Log {
    public static boolean isLoggable(java.lang.String, int);
    public static int v(...);
    public static int d(...);
}
