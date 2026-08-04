import { bundleManager } from '@kit.AbilityKit'

// get_app_info → {version}：前端 platform-bridge.getAppVersion() 消费
export function getAppInfo(): Object {
  const info = bundleManager.getBundleInfoForSelfSync(bundleManager.BundleFlag.GET_BUNDLE_INFO_DEFAULT)
  return { version: info.versionName }
}
