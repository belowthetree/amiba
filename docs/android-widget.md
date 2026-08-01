# 安卓系统桌面卡片（AppWidget）

把卡片放到**安卓系统桌面**（Launcher 小组件）。卡片由服务自带定义，AI 通过 `service_file_*` 工具在服务目录下创建；渲染采用原生 RemoteViews（结构化文本 + 图片，不支持 HTML）。

## 用户使用

1. 让 AI 给某个服务创建桌面卡片（或手写下方目录文件）
2. 长按安卓桌面 → 小组件 → 找到"变形虫"拖上桌面
3. 在弹出的选卡页选择要显示的卡片
4. 点击桌面卡片 → 打开 App 并跳转 `tapPath`（若配置）

App 被杀期间卡片显示最后一次推送的内容（原生 SharedPreferences 缓存）。

## 目录结构

### 服务侧（卡片定义）

```
services/{serviceId}/desktop-widgets/{cardId}/
├── widget.json      # 界面 + 行为配置
├── logic.js         # 逻辑：隐藏沙箱 iframe 中执行，产出渲染数据
└── assets/          # 图片资源（png/jpg）
```

**widget.json**：

```json
{
  "id": "todo-card",
  "label": "待办速览",
  "description": "显示最近 5 条待办",
  "layout": "lines",
  "size": "medium",
  "accentColor": "#5f8f7b",
  "maxLines": 5,
  "tapPath": "/service/user.note-service",
  "updateIntervalMin": 30,
  "enabled": true
}
```

| 字段 | 说明 |
|------|------|
| `label` | 选卡页显示名称（必填） |
| `layout` | `lines`（文本行列表，默认）/ `image`（图片为主）/ `bigText`（大字内容） |
| `size` | 尺寸档位：`small`（2x2）/ `medium`（4x2，默认）/ `large`（4x4）。Android 小组件尺寸只能在 provider meta XML 声明，故三个档位注册为三个 Provider 入口（Launcher 显示「变形虫卡片·小/中/大」），选卡页只列出同尺寸卡片 |
| `accentColor` | 标题颜色，十六进制 |
| `maxLines` | lines 布局最多行数（1-6，默认 6；每行超 60 字截断） |
| `tapPath` | 点击卡片的应用内跳转路径（`/...` 开头） |
| `updateIntervalMin` | App 存活期间逻辑重跑间隔（分钟），0 = 仅启动/手动刷新 |
| `enabled` | 首次扫描时的默认启用状态（之后以全局 registry.json 为准） |

**logic.js**：在隐藏沙箱 iframe 中执行（注入 JSBridge；**脚本自动包在 async 函数中，可直接顶层 `await`**），可用 `desktopWidget.publish` + `storage`（读写本服务数据）两个模块，其余模块拒绝。完成后必须调用一次：

```js
// 例：读取服务数据并发布
const todos = (await __amiba__.storage.get('todos')) || [];
__amiba__.desktopWidget.publish({
  title: '待办清单',
  icon: '📝',
  lines: todos.slice(0, 5).map(t => '· ' + t.text),
  footer: '更新于 ' + new Date().toLocaleTimeString()
});
```

publish 数据字段：`title` / `icon`（emoji）/ `lines`（≤6 条）/ `image`（相对卡片目录，如 `assets/chart.png`）/ `footer`。

**权限**：服务卡片要求 manifest 声明 `desktopWidgets` 权限，否则不注册；全局卡片无权限要求。

### 全局侧（`{AppData}/amiba/desktop-widgets/`）

```
desktop-widgets/
├── registry.json    # { enabled: ["serviceId/cardId", "global/cardId"] } 启用状态（唯一来源）
├── cards/{cardId}/  # 全局卡片定义（不依附服务：widget.json + logic.js + assets/，规范同服务卡片）
├── data/{cardId}/   # 全局卡片 logic.js 的 storage 数据（与服务数据隔离）
└── cache/{serviceId}__{cardId}.json   # 最近渲染载荷（含图片绝对路径）
```

全局卡片由 `android_widget_create` 工具创建，key 格式 `global/{cardId}`，logic.js 规范与 publish 数据格式和服务卡片完全一致。

## 数据流

```
服务 desktop-widgets/ 定义
  → desktop-widget-store.ts 扫描注册（bootstrap 时）→ registry.json
  → desktop-widget-runner.ts 隐藏 iframe 执行 logic.js
      （启动时 + updateIntervalMin 周期 + android_widget_refresh 手动）
  → publish(data) → 合并 widget.json + 图片绝对路径 → cache/*.json
  → invoke('android_widget_update') → Rust widget.rs → JNI
  → Kotlin WidgetHelper.updateCards() → SharedPreferences + 刷新三个 Provider 全部实例
  → AmibaWidgetProvider（中4x2）/ Small（小2x2）/ Large（大4x4）按 appWidgetId→cardKey 绑定渲染 RemoteViews
```

尺寸档位：Android 小组件尺寸只能在 provider meta XML 声明，故 `size`（small/medium/large）注册为三个 Provider 入口（Launcher 显示「变形虫卡片·小/中/大」）；选卡配置页由 appWidgetId 反查 Provider 类名，只列出同尺寸卡片（载荷 `size` 缺省按 medium 兼容旧卡片）。

## AI 工具

| 工具 | 类别 | 说明 |
|------|------|------|
| `android_widget_create` | manage | 创建全局卡片（不依附服务），含 widget.json 字段 + logicJs 内容 |
| `android_widget_list` | view | 列出全部卡片（key/label/启用状态/最近推送时间） |
| `android_widget_enable` | manage | 启用/停用卡片（key 格式 `serviceId/cardId` 或 `global/{cardId}`） |
| `android_widget_refresh` | manage | 立即重跑 logic.js 并推送原生（不传 key 刷全部启用卡片） |
| `android_widget_delete` | manage | 删除卡片（文件 + 启用状态 + 缓存 + 推送原生）；桌面已放置实例显示占位文本，需用户手动移除 |

## 边界与限制

- **仅 Android**：桌面/浏览器端 runner 照常执行 logic 写 cache，推送原生一步跳过（no-op）
- **逻辑只在 App 存活时执行**：`updatePeriodMillis=0`，系统不唤醒 App；被杀期间显示最后缓存
- **RemoteViews 位图限制**：图片按 ≤480px 降采样解码；加载失败隐藏图片区
- **点击跳转**：热启动经 WebView JS 事件即时跳转；WebView 未就绪时暂存 SharedPreferences，下次冷启动由 App.vue 消费

## 经验教训

- **2026-07-31**: `listServiceFiles(serviceId, 'desktop-widgets')` 返回的是**相对于该子目录**的路径（`{cardId}/widget.json`），不带 `desktop-widgets/` 前缀——扫描正则误加前缀导致服务卡片全部注册失败（选卡页"暂无可用卡片"）。教训：调用方必须先确认返回路径的基准目录，此类扫描逻辑要有"扫到 0 个"的告警日志。
- **2026-07-31**: 原生选卡页的数据只来自推送的载荷数组，卡片"已启用但 logic.js 未成功运行过"时列表为空，用户无法区分"没创建"和"没跑成"。修复为无缓存时用 def 合成占位载荷（label + "加载中…"）一并推送，保证启用即可见。
- **2026-07-31**: "新卡片并入启用列表"最初只在 init 执行，会话中途创建的服务卡片要重启才可见。修复为 `rescanDesktopWidgets()` 同样按默认值并入；registry 增加 `seen` 集合区分"新发现"与"用户显式停用"（顺带修了停用后重启被重新启用的问题）。
- **2026-07-31**: logic.js 以经典 `<script>` 注入时顶层 `await` 直接 SyntaxError，卡片永远停在"加载中…"且只有超时日志。修复为 runner 注入时自动包 `(async function(){ ... })()`，顶层 await 与 IIFE 写法均兼容。文档示例此前误用顶层 await，已统一注明自动包裹行为。
- **2026-07-31**: runner 组 srcdoc 时直接拼接 `BRIDGE_SCRIPT` 裸 JS 字符串，未包 `<script>` 标签——垫片不执行、`__amiba__` 未定义，logic.js 立即 ReferenceError（真实表现为卡片永远"加载中…"）。`BRIDGE_SCRIPT` 是纯 JS 不是 HTML 片段，所有消费方（service-container / background-manager / widget-lifecycle）都自行包裹 `<script>` 标签，runner 漏了。教训：复用注入脚本时先核对既有消费方的包裹方式。
- **2026-07-31**: 服务卡片经 `service_file_write/edit` 创建后无任何触发链路（rescan/enable/refresh 都靠 AI 自觉调工具），漏调就要重启才可见。修复为两个 service_file 工具在写入 `desktop-widgets/` 路径后自动 `rescanDesktopWidgets()` + `refreshWidgetCard()`（`afterDesktopWidgetFileChange` 钩子）。
- **2026-07-31**: 卡片尺寸是 AI 的需求（widget.json `size` 字段），但 Android 小组件尺寸只能在 manifest 注册的 provider meta XML 中声明，运行期无法给单个 Provider 改尺寸——方案是固定档位多 Provider（small/medium/large 三个 receiver + 三份 meta XML），选卡页按入口反查尺寸过滤卡片。教训：AppWidget 的"每卡片自定义尺寸"没有运行时 API，档位化是唯一落地路径；新增档位要同步改四处（meta XML / 子类 / manifest / WidgetHelper 刷新列表）。

## 原生层文件（gen/android，`tauri android init` 重置后需恢复）

- `app/src/main/java/com/amiba/desktop/AmibaWidgetProvider.kt`（中尺寸 Provider + WidgetHelper JNI 入口）
- `app/src/main/java/com/amiba/desktop/AmibaWidgetProviderSmall.kt` / `AmibaWidgetProviderLarge.kt`（小/大尺寸档位，纯标记子类）
- `app/src/main/java/com/amiba/desktop/WidgetConfigActivity.kt`（选卡配置页，按入口尺寸过滤卡片）
- `app/src/main/res/layout/widget_card.xml` / `widget_card_image.xml` / `widget_card_bigtext.xml` / `widget_config.xml`
- `app/src/main/res/drawable/widget_bg.xml`
- `app/src/main/res/values/styles_widget.xml`
- `app/src/main/res/xml/widget_card_info.xml`（中 4x2）/ `widget_card_info_small.xml`（小 2x2）/ `widget_card_info_large.xml`（大 4x4）
- `AndroidManifest.xml`（三个 receiver 分别带「变形虫卡片·小/中/大」label + configure activity 注册）
- `AndroidManifest.xml`（receiver + configure activity 注册）
- `MainActivity.kt`（widget 点击跳转处理段）
