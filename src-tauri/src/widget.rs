// ============================================================
// 变形虫 (Amiba) — widget 模块：Android 系统桌面卡片桥接
//
// android_widget_update: 前端推送全部启用卡片 JSON → JNI 调
//   WidgetHelper.updateCards() → SharedPreferences + 刷新实例
// android_widget_consume_tap: 前端 bootstrap 时消费一次桌面卡片
//   点击的跳转路径（WebView 未就绪时的兜底通道）
// 非 Android 平台均为 no-op。
// ============================================================

use tauri::AppHandle;

#[tauri::command]
#[cfg_attr(not(target_os = "android"), allow(dead_code, unused_variables))]
pub async fn android_widget_update(app: AppHandle, json: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        android_call(&app, "updateCards", "(Ljava/lang/String;)V", Some(json))?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(())
    }
}

#[tauri::command]
#[cfg_attr(not(target_os = "android"), allow(dead_code, unused_variables))]
pub async fn android_widget_consume_tap(app: AppHandle) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        android_call(&app, "consumeTapPath", "()Ljava/lang/String;", None)
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(String::new())
    }
}

/// 调 com.amiba.desktop.WidgetHelper 的静态方法。
/// method 为 updateCards 时带 String 参数（返回 void，本函数返回空串）；
/// 为 consumeTapPath 时无参、返回 String。
#[cfg(target_os = "android")]
fn android_call(
    app: &AppHandle,
    method: &str,
    sig: &str,
    arg: Option<String>,
) -> Result<String, String> {
    use tauri::Manager;

    let jvm_state = app.state::<crate::AndroidJvm>();
    let vm = jvm_state.get_vm()?;

    let mut env = vm
        .attach_current_thread()
        .map_err(|e| format!("JNI attach failed: {e}"))?;

    let cls = crate::android_util::find_app_class(&mut env, "com.amiba.desktop.WidgetHelper")?;

    let result = match arg {
        Some(payload) => {
            let jarg = env
                .new_string(payload)
                .map_err(|e| format!("new_string: {e}"))?;
            env.call_static_method(
                &cls,
                method,
                sig,
                &[jni::objects::JValue::Object(&jarg.into())],
            )
            .map_err(|e| format!("WidgetHelper.{method} JNI call failed: {e}"))?;
            return Ok(String::new());
        }
        None => env
            .call_static_method(&cls, method, sig, &[])
            .map_err(|e| format!("WidgetHelper.{method} JNI call failed: {e}"))?,
    };

    let jobj = result
        .l()
        .map_err(|e| format!("WidgetHelper.{method} returned non-object: {e}"))?;
    let jstr: jni::objects::JString = jobj.into();
    let content: String = env
        .get_string(&jstr)
        .map_err(|e| format!("Failed to read result: {e}"))?
        .into();

    Ok(content)
}
