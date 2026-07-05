// ============================================================
// 变形虫 (Amiba) — i18n 初始化 + settings.language 同步
// ============================================================
import { createI18n } from 'vue-i18n'
import { watch } from 'vue'
import { settings } from '../config/config'
import zhCN from './locales/zh-CN'
import en from './locales/en'

const messages = {
  'zh-CN': zhCN,
  en,
}

export const i18n = createI18n({
  legacy: false,
  locale: settings.language || 'zh-CN',
  fallbackLocale: 'zh-CN',
  messages: messages as any,
})

export function syncI18nWithSettings() {
  watch(
    () => settings.language,
    (lang) => {
      ;(i18n.global.locale as any).value = lang
    }
  )
}
