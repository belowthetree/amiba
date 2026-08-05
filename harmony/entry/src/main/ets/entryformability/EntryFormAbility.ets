import { FormExtensionAbility, formBindingData, formInfo } from '@kit.FormKit'
import { Want } from '@kit.AbilityKit'
import {
  initFormDirs,
  assignOnAdd,
  removeForm,
  pushForm,
  buildBindingData,
  dimensionToSize,
  layoutFromFormName
} from '../bridge/FormStore'

const TAG = '[AmibaForm]'

// ============================================================
// 变形虫 (Amiba) — 系统桌面卡片 FormExtensionAbility（对应 Android
// AmibaWidgetProvider 三 receiver 子类；鸿蒙单 ability 经 form_config.json
// 的 supportDimensions 覆盖 2*2/2*4/4*4 三档，无需按尺寸分裂）
//
// 三张卡片模板（amiba_lines / amiba_image / amiba_bigtext）在 form_config.json
// 各声明一条 form 记录，src 指向 ets/pages/form/ 下对应 ArkTS 卡面；
// 用户在系统选卡页选模板+尺寸加到桌面 → onAddForm 自动绑定启用卡片
// （分配策略见 FormStore.pickCard，平移 WidgetConfigActivity 按尺寸过滤语义）。
//
// 刷新为事件驱动（form_config.json updateDuration=0）：前端
// desktop-widget-store.ts pushToNative → form_widget_update →
// FormStore.pushAllForms → formProvider.updateForm。
// ============================================================

export default class EntryFormAbility extends FormExtensionAbility {
  onAddForm(want: Want): formBindingData.FormBindingData {
    initFormDirs(this.context.filesDir)

    const params = want.parameters ?? {}
    const formId = String(params[formInfo.FormParam.IDENTITY_KEY] ?? '')
    const dimValue = params[formInfo.FormParam.DIMENSION_KEY]
    const dimension = typeof dimValue === 'number' ? dimValue : 0
    const nameValue = params[formInfo.FormParam.NAME_KEY]
    const formName = typeof nameValue === 'string' ? nameValue : ''
    const size = dimensionToSize(dimension)
    const layout = layoutFromFormName(formName)
    console.log(`${TAG} === onAddForm: formId=${formId} name=${formName} dimension=${dimension} → layout=${layout} size=${size} ===`)

    // 绑定启用卡片并持久化映射（无启用卡时绑定占位，后续推送自动补绑）
    const card = assignOnAdd(formId, layout, size)
    const built = buildBindingData(card)
    // 注意：onAddForm 同步返回，框架渲染初始数据时仍需读取 formImages 的 fd，
    // 沿用官方本地图片示例不关闭（单次加卡泄漏一个 fd，进程退出回收）
    return built.bindingData
  }

  onUpdateForm(formId: string): void {
    // 系统侧触发的刷新请求（reloadForms 等；定时刷新已关闭）：从持久化数据重推
    console.log(`${TAG} onUpdateForm: formId=${formId}`)
    pushForm(formId).catch((e: Error) => {
      console.error(`${TAG} ✗ onUpdateForm 刷新失败 formId=${formId}: ${e.message}`)
    })
  }

  onRemoveForm(formId: string): void {
    console.log(`${TAG} === onRemoveForm: formId=${formId} ===`)
    removeForm(formId)
  }

  onFormEvent(formId: string, message: string): void {
    // postCardAction 'message' 事件——当前卡面仅用 router 跳转，无 message 交互，仅记日志
    console.log(`${TAG} onFormEvent: formId=${formId} message=${message}`)
  }

  onCastToNormalForm(formId: string): void {
    console.log(`${TAG} onCastToNormalForm: formId=${formId}`)
  }

  onChangeFormVisibility(newStatus: Record<string, number>): void {
    console.log(`${TAG} onChangeFormVisibility: ${JSON.stringify(newStatus)}`)
  }
}
