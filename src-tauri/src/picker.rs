// ============================================================
// 变形虫 (Amiba) — picker 模块
// ============================================================
// pick_folder 已迁移至 tauri-plugin-android-fs (SAF Picker)，
// 前端通过 folder-picker.ts 统一调用。
// read_tombstone: Android JNI 崩溃诊断，保留。
// ============================================================

use tauri::AppHandle;

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
