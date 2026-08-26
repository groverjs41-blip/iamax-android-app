# Proguard rules for IAmax Launcher
-keepattributes JavascriptInterface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.iamax.launcher.bridge.** { *; }
