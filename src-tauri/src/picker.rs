// ============================================================
// 变形虫 (Amiba) — pick_folder Command
// ============================================================
// Android 端通过 JNI 调用 FolderPickerHelper.pickFolder() 启动
// ACTION_OPEN_DOCUMENT_TREE 原生文件夹选取器。
// 桌面端由前端 @tauri-apps/plugin-dialog 处理，此处不实现。
// ============================================================

use tauri::AppHandle;

#[tauri::command]
#[allow(unused_variables)]
pub async fn pick_folder(
    app: AppHandle,
    title: Option<String>,
) -> Result<String, String> {
    let _title = title.unwrap_or_else(|| "选择文件夹".to_string());

    #[cfg(target_os = "android")]
    {
        pick_folder_android(&app).await
    }

    #[cfg(not(target_os = "android"))]
    {
        // 桌面端：由前端 @tauri-apps/plugin-dialog 处理
        // 如果意外走到这里，返回错误提示
        Err("pick_folder command is Android-only; use @tauri-apps/plugin-dialog on desktop".into())
    }
}

// ============================================================
// Android JNI 实现
// ============================================================

#[cfg(target_os = "android")]
async fn pick_folder_android(app: &AppHandle) -> Result<String, String> {
    use jni::objects::JValue;
    use jni::JavaVM;
    use tauri::Manager;

    let jvm_ptr = app.state::<crate::AndroidJvm>();
    let vm = unsafe {
        JavaVM::from_raw(jvm_ptr.0 as *mut _)
    }.map_err(|e| format!("JVM: {e}"))?;

    let mut env = vm
        .attach_current_thread()
        .map_err(|e| format!("attach: {e}"))?;

    let helper_cls = find_app_class(&mut env, "com.amiba.desktop.FolderPickerHelper")?;

    let timeout = 60_000i64; // 60 秒超时
    let result = env
        .call_static_method(
            &helper_cls,
            "pickFolder",
            "(J)Ljava/lang/String;",
            &[JValue::Long(timeout)],
        )
        .map_err(|e| format!("FolderPickerHelper.pickFolder: {e}"))?;

    let jobj = result.l().map_err(|e| format!("result obj: {e}"))?;
    let jstr: jni::objects::JString = jobj.into();
    let path: String = env
        .get_string(&jstr)
        .map_err(|e| format!("get_string: {e}"))?
        .into();

    if path.is_empty() {
        eprintln!("[picker] 用户取消或超时");
        return Err("用户取消".into());
    }

    eprintln!("[picker] 选取文件夹: {path}");
    Ok(path)
}

/// 使用 Application ClassLoader 查找 app 类（native 线程只有 system class loader）
#[cfg(target_os = "android")]
fn find_app_class<'a>(
    env: &mut jni::JNIEnv<'a>,
    name: &str,
) -> Result<jni::objects::JClass<'a>, String> {
    use jni::objects::JObject;
    use jni::objects::JValue;

    // 通过 ActivityThread 拿到 Application Context
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
        .map_err(|e| format!("obj: {e}"))?;
    let app = env
        .call_method(
            &at_obj,
            "getApplication",
            "()Landroid/app/Application;",
            &[],
        )
        .map_err(|e| format!("getApplication: {e}"))?
        .l()
        .map_err(|e| format!("obj: {e}"))?;

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
        .map_err(|e| format!("obj: {e}"))?;

    // ClassLoader.loadClass(name)
    let jname = env
        .new_string(name)
        .map_err(|e| format!("str: {e}"))?;
    let cls = env
        .call_method(
            &class_loader,
            "loadClass",
            "(Ljava/lang/String;)Ljava/lang/Class;",
            &[JValue::Object(&JObject::from(jname))],
        )
        .map_err(|e| format!("loadClass({name}): {e}"))?
        .l()
        .map_err(|e| format!("obj: {e}"))?;

    Ok(cls.into())
}
