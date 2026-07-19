// ============================================================
// 变形虫 (Amiba) — Android JNI 公共工具
// ============================================================
// 提供 picker.rs / web.rs 共享的 JNI 辅助函数。
// 消除 find_app_class 在 picker.rs 和 web.rs 中重复定义的
// 代码异味。
// ============================================================

#![cfg(target_os = "android")]

use jni::objects::{JObject, JValue};

/// 通过 JNI 获取 Android Application Context。
/// 路径：ActivityThread.currentActivityThread() → getApplication()
pub(crate) fn get_app_context<'a>(env: &mut jni::JNIEnv<'a>) -> Result<JObject<'a>, String> {
    let at_cls = env
        .find_class("android/app/ActivityThread")
        .map_err(|e| format!("ActivityThread class: {e}"))?;
    let at_obj = env
        .call_static_method(
            &at_cls,
            "currentActivityThread",
            "()Landroid/app/ActivityThread;",
            &[],
        )
        .map_err(|e| format!("currentActivityThread: {e}"))?
        .l()
        .map_err(|e| format!("currentActivityThread obj: {e}"))?;
    let app = env
        .call_method(
            &at_obj,
            "getApplication",
            "()Landroid/app/Application;",
            &[],
        )
        .map_err(|e| format!("getApplication: {e}"))?
        .l()
        .map_err(|e| format!("getApplication obj: {e}"))?;
    Ok(app)
}

/// 使用 Application ClassLoader 查找 app 类。
///
/// native 线程默认只有 system class loader，找不到应用自定义类
/// （如 com.amiba.desktop.WebViewHelper / FolderPickerHelper）。
/// 需要通过 ActivityThread → Application → ClassLoader 获取
/// 能加载 app 类的 class loader。
pub(crate) fn find_app_class<'a>(
    env: &mut jni::JNIEnv<'a>,
    name: &str,
) -> Result<jni::objects::JClass<'a>, String> {
    let app = get_app_context(env)?;

    // Context.getClassLoader()
    let class_loader = env
        .call_method(
            &app,
            "getClassLoader",
            "()Ljava/lang/ClassLoader;",
            &[],
        )
        .map_err(|e| format!("getClassLoader: {e}"))?
        .l()
        .map_err(|e| format!("getClassLoader obj: {e}"))?;

    // ClassLoader.loadClass(name)
    let jname = env
        .new_string(name)
        .map_err(|e| format!("new_string: {e}"))?;
    let cls = env
        .call_method(
            &class_loader,
            "loadClass",
            "(Ljava/lang/String;)Ljava/lang/Class;",
            &[JValue::Object(&jname.into())],
        )
        .map_err(|e| format!("loadClass({name}): {e}"))?
        .l()
        .map_err(|e| format!("loadClass({name}) obj: {e}"))?;

    Ok(cls.into())
}
