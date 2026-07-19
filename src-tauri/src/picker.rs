// ============================================================
// 变形虫 (Amiba) — pick_folder Command
// ============================================================
// Android 端通过 JNI 调用 FolderPickerHelper.pickFolder() 启动
// ACTION_OPEN_DOCUMENT_TREE 原生文件夹选取器。
// 桌面端由前端 @tauri-apps/plugin-dialog 处理，此处不实现。
// ============================================================

use tauri::AppHandle;

#[tauri::command]
#[cfg_attr(not(target_os = "android"), allow(dead_code, unused_variables))]
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
        Err("pick_folder is Android-only".into())
    }
}

// ============================================================
// Android JNI 实现
// ============================================================

#[cfg(target_os = "android")]
async fn pick_folder_android(app: &AppHandle) -> Result<String, String> {
    use jni::objects::JValue;
    use tauri::Manager;

    eprintln!("[picker] === pick_folder_android start ===");

    let jvm_state = app.state::<crate::AndroidJvm>();
    let vm = jvm_state.get_vm()?;

    let mut env = vm
        .attach_current_thread()
        .map_err(|e| format!("JNI attach failed: {e}"))?;

    eprintln!("[picker] JNI attached, finding FolderPickerHelper class...");
    let helper_cls = crate::android_util::find_app_class(&mut env, "com.amiba.desktop.FolderPickerHelper")?;

    let timeout = 60_000i64; // 60 秒超时
    eprintln!("[picker] calling FolderPickerHelper.pickFolder({timeout}ms)...");
    let result = env
        .call_static_method(
            &helper_cls,
            "pickFolder",
            "(J)Ljava/lang/String;",
            &[JValue::Long(timeout)],
        )
        .map_err(|e| format!("FolderPickerHelper.pickFolder JNI call failed: {e}"))?;

    let jobj = result.l().map_err(|e| format!("pickFolder returned non-object: {e}"))?;
    let jstr: jni::objects::JString = jobj.into();
    let path: String = env
        .get_string(&jstr)
        .map_err(|e| format!("Failed to read result string: {e}"))?
        .into();

    if path.is_empty() {
        eprintln!("[picker] 用户取消或超时");
        return Err("用户取消".into());
    }

    eprintln!("[picker] ✓ 选取文件夹: {path}");
    Ok(path)
}

// ============================================================
// read_tombstone — 读取上次 native crash 的 tombstone 堆栈
// Android 通过 JNI 调用 MainActivity.getLastTombstone()
// 桌面端返回空（无 Android tombstone 机制）
// ============================================================

#[tauri::command]
#[cfg_attr(not(target_os = "android"), allow(dead_code, unused_variables))]
pub async fn read_tombstone(app: AppHandle) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        read_tombstone_android(&app).await
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(String::new())
    }
}

#[cfg(target_os = "android")]
async fn read_tombstone_android(app: &AppHandle) -> Result<String, String> {
    use jni::objects::JValue;
    use tauri::Manager;

    let jvm_state = app.state::<crate::AndroidJvm>();
    let vm = jvm_state.get_vm()?;

    let mut env = vm
        .attach_current_thread()
        .map_err(|e| format!("JNI attach failed: {e}"))?;

    let main_cls = crate::android_util::find_app_class(&mut env, "com.amiba.desktop.MainActivity")?;

    let result = env
        .call_static_method(
            &main_cls,
            "getLastTombstone",
            "()Ljava/lang/String;",
            &[],
        )
        .map_err(|e| format!("getLastTombstone JNI call failed: {e}"))?;

    let jobj = result.l().map_err(|e| format!("getLastTombstone returned non-object: {e}"))?;
    let jstr: jni::objects::JString = jobj.into();
    let content: String = env
        .get_string(&jstr)
        .map_err(|e| format!("Failed to read result: {e}"))?
        .into();

    Ok(content)
}
