# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# ============================================================
# JNI 入口 keep：以下类/方法由 Rust 按类名+方法名反射调用
# （src-tauri/src/widget.rs / web.rs / picker.rs），Java 侧无
# 静态引用，release 混淆时会被 R8 重命名或裁掉导致 JNI 失败。
# ============================================================
-keep class com.amiba.desktop.WidgetHelper { *; }
-keep class com.amiba.desktop.WebViewHelper { *; }
-keep class com.amiba.desktop.JsCallback { *; }
-keep class com.amiba.desktop.MainActivity { *; }
-keep class com.amiba.desktop.MainActivity$* { *; }
-keep class com.amiba.desktop.AmibaWidgetProvider { *; }
-keep class com.amiba.desktop.WidgetConfigActivity { *; }