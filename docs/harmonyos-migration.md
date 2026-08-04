# 鸿蒙（HarmonyOS NEXT）迁移方案设计

> 状态：**实施中**（分支 `harmony-migration`）。盘点数据来自对当前代码库的全量扫描，外部事实经检索核实（截至 2026-08）。
>
> 实施进度：
> - ✅ 前端适配层：`src/types/native-bridge.ts`（命令协议注册表）、`src/config/platform-bridge.ts`（宿主探测 + invoke/listen 分发）、`src/config/native-fs.ts`（plugin-fs/path 兼容 shim）；业务代码已全量替换直连 import
> - ✅ 鸿蒙壳 PoC 骨架：`harmony/`（DevEco 工程；javaScriptProxy 双向桥 + `fs_*` 命令族 + `get_app_info`；`npm run harmony:sync` 同步 dist → rawfile）
> - ⬜ 阶段 0 真机验证（README 验证清单）→ 阶段 1：会话库（LIKE 退化）/ HTTP 三命令 / `web_fetch`（ArkWeb 池）
> - ⬜ 阶段 0' 并行探针：社区 Tauri OHOS fork（richerfu/tauri）真机编译验证

## 1. 目标与范围

- **目标平台**：HarmonyOS NEXT 5.0+（API 12+，纯血鸿蒙，无 AOSP 兼容层），手机/平板形态为主。
- **无需迁移的形态**：HarmonyOS 4.x 及更早版本基于 AOSP，可直接安装现有 Android APK。
- **非目标**：iOS、OpenHarmony IoT 设备；鸿蒙 PC（2-in-1）可作为同方案的延伸形态（Stage 模型自适应窗口）。

核心结论先行：

1. **Tauri 官方不支持鸿蒙**（[tauri#12640](https://github.com/tauri-apps/tauri/issues/12640) 仍开放），框架层必须替换或走社区 fork。
2. **本项目架构天然适合迁移**：全部 UI 与业务逻辑在 Web 层（Vue 3 静态产物 `dist/`），原生层仅是一组 invoke 命令 + 事件推送，与「ArkTS 壳 + ArkWeb 容器」架构完全同构。AI 生成的服务本身就是 HTML/iframe 沙箱，这一核心资产在任何非 Web 路线下都无法保留。
3. **推荐方案 A（自研 ArkTS 薄壳）**，前端复用率约 95%；方案 B（社区 Tauri OHOS fork）作为并行探针跟踪。

## 2. 迁移基线：平台耦合点盘点

### 2.1 分层现状

```
Vue 3 前端（src/，构建产物 dist/ 纯静态）
  ├─ iframe srcdoc 服务沙箱 + postMessage JSBridge（src/host/service-container.vue:20）
  └─ Tauri 通道
       ├─ invoke × 31（@tauri-apps/api/core）
       ├─ listen × 8 种事件（network:* × 6、download-progress、webview-screenshot）
       └─ plugin-fs × 175+ 处动态 import（23 个文件直连，绕过 storage.ts 抽象）
Rust 原生层（src-tauri/src/）
  ├─ lib.rs      — 34 命令注册、HTTP×3（download_file / service_http_request / web_fetch fallback）
  ├─ db.rs       — SQLite FTS5 会话库，8 命令
  ├─ web.rs      — WebView 浏览器引擎（桌面/Android/iOS 三路径），7 命令
  ├─ network_visibility.rs — UDP 发现，7 命令
  ├─ network_session.rs    — WebSocket 会话（含服务端 accept），6 命令
  ├─ widget.rs / picker.rs — Android 卡片桥 / tombstone
  └─ Android JVM 链路（libloading 找 JVM → ActivityThread 反射 → 按名 call_static_method，JSON 传参）
Android Kotlin 层（src-tauri/gen/android/）
  ├─ MainActivity.kt — setupWindowInsets、WebViewHelper/JsCallback（隐藏 WebView 引擎）、崩溃诊断
  └─ AppWidget 三尺寸 Provider + WidgetConfigActivity + RemoteViews 布局 ×3
```

### 2.2 前端 → 原生命令清单（31 条）

| 分组 | 命令 | 前端封装 |
|---|---|---|
| Web 引擎（6） | `web_fetch` `web_get_content` `web_click` `web_input_text` `web_close` `web_capture_screenshot` | `src/config/web-bridge.ts` |
| 会话库（8） | `search_sessions` `index_message` `index_message_batch` `get_session` `list_sessions_cmd` `delete_session_cmd` `scroll_session` `read_session_cmd` | `src/config/session-db.ts` |
| LAN 网络（12） | `network_set_visibility` `network_get_visibility` `network_start_discovery` `network_stop_discovery` `network_get_device_id` `network_get_device_name` `network_connect` `network_send` `network_disconnect` `network_start_listener` `network_stop_listener`（+ Rust 侧未用的 3 条） | `src/host/network-bridge.ts` `network-session.ts` |
| HTTP（3） | `download_file` `cancel_download` `service_http_request` | `updater.ts` / JSBridge `fetch` 模块 |
| 卡片（2） | `android_widget_update` `android_widget_consume_tap` | `src/config/desktop-widget-store.ts:520,555` |
| 诊断（1） | `read_tombstone` | `SettingsPage.vue:725` |

### 2.3 对迁移有利的现状

- 宿主代码 **零 `localStorage` 直用**，持久化全部走文件（plugin-fs），存储语义清晰。
- 桌面卡片 runner（`desktop-widget-runner.ts`）**本身跑在前端隐藏 iframe 里**，不含任何 Tauri import——卡片数据生产链路可原样平移，只需替换最后的 `pushToNative` 通道。
- web.rs 的 click/input/extract/get_content 逻辑**全是注入 JS**（`EXTRACT_JS`/`GET_CONTENT_JS` 等），ArkWeb `runJavaScript` 下原样可用。
- 卡片 JSON 载荷协议（key/size/layout/tapPath/accentColor/lines/image…）**与平台无关**，可原样保留。
- 浏览器降级路径已存在（folder-picker 三段式、skill-zip 双模式），说明前端已习惯「能力缺失时降级」的写法。

### 2.4 迁移前置债（借迁移偿还）

- **平台探测混乱**：动态 `import('@tauri-apps/api/core')` 探测在纯浏览器下恒 true（包被打进产物），`'__TAURI__' in window` 与 UA 探测并存。迁移时统一为单一 `platformBridge` 探测点。
- **23 个文件直连 plugin-fs**，且用到 storage.ts 未封装的能力（`stat`/`rename`/`exists`/绝对路径/`appCacheDir`）。前置重构：新建 `src/config/native-fs.ts` 统一导出（内部按平台分发），全局机械替换 `@tauri-apps/plugin-fs` import——对现有 Tauri 平台无损。

## 3. 方案选型

| | A. ArkTS 壳 + ArkWeb（推荐） | B. 社区 Tauri OHOS fork | C. 跨端框架 / ArkUI 重写 |
|---|---|---|---|
| 路线 | 自研薄壳：ArkUI 单 Page 嵌 ArkWeb 加载 dist，javaScriptProxy 桥替换 invoke | [richerfu/tauri `feat/open-harmony`](https://github.com/richerfu/tauri-demo) + OHOS 化 wry/tao + [harmony-contrib/openharmony-ability](https://github.com/harmony-contrib/openharmony-ability)，Rust 层整体保留 | Flutter ohos / RN / uni-app x / 纯 ArkUI |
| 前端复用 | ~95% | ~100% | 0%（UI 全重写） |
| Rust 层复用 | 0%（ArkTS 重写 34 命令） | 大部分（插件生态支持度未知） | 0% |
| Android 专属链（JNI/卡片/SAF） | 重写 | 仍要重写 | 重写 |
| 服务沙箱（核心资产） | 保留（ArkWeb iframe srcdoc） | 保留 | **无法保留**（AI 产物是 HTML） |
| 成熟度风险 | 低（全是官方 API，业界 H5 容器成熟实践） | **高**（个人 fork，非官方分支，主要验证于鸿蒙 PC/OpenHarmony，手机/插件/上架链路未验证） | 中 |
| 控制度 | 完全自控 | 依赖社区更新节奏 | — |

结论：

- **方案 A 为主线**。工作量集中在 ArkTS 原生层重写（§5 映射表），但每一项都有官方 API 对应，无未知深坑；且桥协议自行设计后可同时服务未来的 iOS 壳。
- **方案 B 作为 1 周探针（spike）并行验证**：若其 wry OHOS 适配在手机 HarmonyOS NEXT 真机可用且 fs/dialog 插件链路通，则 Rust 层（尤其 network/db 两大模块）可整体保留，性价比会反超方案 A。PoC 不达标即放弃，不阻塞主线。
- **方案 C 否决**：AI 即时应用平台的服务产物是 HTML，任何非 Web 容器路线都等于推翻产品形态。

## 4. 目标架构（方案 A）

```
┌─ HarmonyOS 应用（DevEco 工程，主仓 harmony/ 目录）─────────────────┐
│ EntryAbility（单 UIAbility，edge-to-edge，avoidArea 处理）          │
│  └─ Index.ets（单 Page）                                            │
│       └─ Web 组件（ArkWeb，resource://rawfile/dist/index.html）     │
│            ├─ javaScriptProxy 注入 window.__AMIBA_HARMONY__         │
│            │    invoke(cmd, argsJson): Promise<string>  ← H5→原生   │
│            └─ runJavaScript("__amiba_harmony_emit__(evt,payload)")  │
│                                                    ← 原生→H5 事件   │
│ 原生服务层（ArkTS，与前端命令一一对应）                              │
│  ├─ FsBridge      fileIo，BaseDirectory.AppData → context.filesDir  │
│  ├─ SessionDb     relationalStore（FTS5 缺口见 §6.1）               │
│  ├─ WebEngine     隐藏 ArkWeb 池（对应 web.rs）                     │
│  ├─ NetBridge     UDPSocket 发现 + TCPSocket 自实现 WS 服务端        │
│  ├─ HttpBridge    http.createHttp × 3 命令                          │
│  ├─ FormBridge    FormExtensionAbility 卡片（对应 widget.rs+Kotlin）│
│  └─ PickerBridge  DocumentViewPicker（对应 SAF/dialog）             │
└─────────────────────────────────────────────────────────────────────┘
前端（主仓 src/，单一代码库继续服务桌面/Android/鸿蒙）
  └─ 新增 src/config/platform-bridge.ts — 唯一平台探测点 + invoke/listen 分发
     新增 src/config/native-fs.ts      — plugin-fs 兼容 shim（签名不变，内部分发）
```

### 4.1 桥协议设计（与 Tauri 同构，前端改动最小化）

- **H5 → 原生**：`__AMIBA_HARMONY__.invoke(cmd, jsonArgs)` 返回 `Promise<string>`（javaScriptProxy 支持 async 方法）。命令名、参数、返回值与现有 Tauri 命令**完全一致**，ArkTS 侧做 `JSON.parse` → 分发 → `JSON.stringify(result)`。
- **原生 → H5**：ArkTS 侧 `runJavaScript` 调用前端预置的 `window.__amiba_harmony_emit__(event, payload)`；前端 `platform-bridge.ts` 把它包装成与 `@tauri-apps/api/event.listen` 相同的语义。8 种现有事件名不变。
- **前端分发逻辑**：

```ts
// platform-bridge.ts 核心逻辑（示意）
export type HostPlatform = 'tauri' | 'harmony' | 'browser'
export function detectHost(): HostPlatform {
  if ('__AMIBA_HARMONY__' in window) return 'harmony'
  if ('__TAURI__' in window) return 'tauri'
  return 'browser'
}
export async function nativeInvoke<T>(cmd: string, args?: unknown): Promise<T> {
  if (host === 'harmony') return JSON.parse(await __AMIBA_HARMONY__.invoke(cmd, JSON.stringify(args ?? {})))
  if (host === 'tauri')   return (await import('@tauri-apps/api/core')).invoke<T>(cmd, args as any)
  throw new Error('native bridge unavailable')
}
```

- **fs shim**：`native-fs.ts` 完整复刻 `@tauri-apps/plugin-fs` 的导出签名（`readTextFile/writeTextFile/readFile/writeFile/readDir/mkdir/remove/exists/rename/stat + BaseDirectory.AppData/appCacheDir` 枚举），harmony 分支转 `nativeInvoke('fs_read_text_file', {path, baseDir})` 等一族新命令；tauri 分支原样转发插件。`BaseDirectory` 语义在 ArkTS 侧解析（AppData → `context.filesDir`，appCacheDir → `context.cacheDir`）。**23 个直连文件零逻辑改动，仅 import 来源变化。**

### 4.2 dist 加载方式

推荐 **`resource://rawfile/dist/index.html`**（dist 随 HAP 打包）：

- 只读但够用——服务 HTML 走 `iframe srcdoc`（`service-container.vue:20`），不依赖 dist 目录可写。
- 合规：鸿蒙审核对「动态下发可执行代码」敏感，rawfile 内置前端、版本随应用更新，无热更新风险。
- 待验证项：`/libs/jade.css`、`/docs/*` 等**绝对路径引用**在 resource 协议下的解析行为；若异常则前端改为相对路径或 ArkWeb 拦截器映射。

备选：首启解压到 filesDir 用 `file://` 加载——为将来的「前端资源随服务仓库更新」留口子，首期不做。

### 4.3 构建目标

`vite.config.ts` 当前无显式 target。ArkWeb 内核基于 Chromium（HarmonyOS 5.0 约为 Chromium 114），Vite 8 默认产物兼容；`src/config/polyfill.ts` 的 `.at()` 垫片保留无害。建议显式 `build.target: 'chrome100'` 锁定下限，并在 PoC 真机验证。

### 4.4 Vue 界面层：零改写

**Vue 界面 100% 复用，不存在「鸿蒙版界面重写」。** 用户看到的全部产品界面（聊天/服务/快捷/设置/记忆 6 页、左右滑动手势、玻璃背景动画、30 个 CSS 变量主题体系）都是 Web 渲染——鸿蒙侧的呈现形态与 Tauri 桌面/Android 完全同构：ArkTS 壳只有一个装 ArkWeb 组件的 Page，加载 `dist/index.html` 后 Vue 应用整体运行其中。

鸿蒙侧需要新写的原生「界面」只有三处平台功能性 UI，均不属于产品界面：

- 壳 Page（ArkUI 单组件容器，无业务 UI 逻辑）
- 系统桌面卡片（FormKit ArkTS 声明式三模板，§5.6）
- 选卡配置页（对应 Android `WidgetConfigActivity`）

Vue 层的适配点全部是**管线而非视觉**：

| 适配点 | 现状 | 鸿蒙处理 |
|---|---|---|
| 原生调用通道 | `@tauri-apps/api/core` invoke + plugin-fs 直连 | `platform-bridge` / `native-fs` shim，import 来源机械替换（§4.1） |
| edge-to-edge 安全区 | 无 `viewport-fit=cover`（`index.html:6`），`env(safe-area-inset-*)` 恒 0（`App.vue:536`、`ChatPage.vue:1317` 仅为兜底）；实际靠 Kotlin `setupWindowInsets()` 给内容区加原生 padding | **同法**：ArkTS 侧用 `getWindowAvoidArea`（systemBars + IME）给 Web 组件加 padding，CSS 零改动；`env()` 兜底继续无害存在 |
| 软键盘 | `interactive-widget=resizes-content` + Android IME inset padding | ArkTS avoidArea 含 IME 避让；PoC 验证 ArkWeb 内输入框弹键盘行为 |
| 文件导出 | `Blob` + `a.download`（日志/设置备份/ZIP） | ArkWeb `onDownloadStart` 委托桥接落盘 |
| 文件导入 | `<input type=file>`（服务包/ZIP 导入） | ArkWeb `onShowFileSelector` 接 Picker |
| 手势/动画/主题 | 纯 Web 实现（touch 事件、CSS 变量、`prefers-reduced-motion`） | 零改动，Chromium 内核原生支持 |

## 5. 命令/能力映射表

### 5.1 新增 fs 命令族（对应 plugin-fs，面最广但最机械）

| shim API | ArkTS 实现 | 复杂度 |
|---|---|---|
| readTextFile / writeTextFile / readFile / writeFile | `fileIo.openSync` + read/write，UTF-8 | 低 |
| readDir / mkdir / remove / exists / rename / stat | `fileIo.listFile` / `mkdir` / `rmdir`+递归 / `accessSync` / `rename` / `stat` | 低 |
| BaseDirectory.AppData / appCacheDir | `context.filesDir` / `context.cacheDir` | 低 |

路径安全：shim 保留 `storage.ts:136` 的 `safePath` 防穿越逻辑；ArkTS 侧再做一次沙箱根目录校验。

### 5.2 会话库（db.rs，8 命令）

| 命令 | 鸿蒙实现 | 复杂度 |
|---|---|---|
| `index_message` `index_message_batch` `get_session` `list_sessions_cmd` `delete_session_cmd` `scroll_session` `read_session_cmd` | `relationalStore` 平铺 CRUD + 谓词查询，直接对应 | 低 |
| `search_sessions` | **FTS5 缺口**，方案见 §6.1 | 高 |

### 5.3 Web 引擎（web.rs，6 命令）

| 命令 | 鸿蒙实现 | 复杂度 |
|---|---|---|
| `web_fetch`（WebView 路径） | 隐藏 ArkWeb 池：`WebviewController.loadUrl` + `onPageEnd` + 注入现有 `EXTRACT_JS`（innerText 截断） | 中 |
| `web_fetch`（HTTP fallback，`raw` HTML） | `http.createHttp` + HTML 正文提取（ArkTS 解析库或简化剥标签，对应 Rust scraper） | 中 |
| `web_click` `web_input_text` `web_get_content` | **注入 JS 原样平移**（鼠标事件序列/native setter/React 兼容逻辑全是 JS） | 低 |
| `web_close` | 池销毁 | 低 |
| `web_capture_screenshot` | ArkWeb 原生 `snapshotPixelMap`，**比 html2canvas 注入更简单可靠** | 低 |
| URL 安全校验 | `is_safe_url`（web.rs:129）逻辑 ArkTS 重写一遍 | 低 |

「隐藏 WebView 同步等待加载」协议（Kotlin 侧 `CountDownLatch`/`JsCallback` 那套）在 ArkTS 用 Promise/async 自然表达，比 Android 实现更简单。

### 5.4 LAN 网络（network_*.rs，12 命令）

| 能力 | 鸿蒙实现 | 复杂度/风险 |
|---|---|---|
| UDP 发现（端口 28880，3s 广播 + 15s 失联判定） | `UDPSocket`（`setBroadcast(true)`）。**多网卡枚举算定向广播地址无 API**，降级为仅 `255.255.255.255` 全网广播 | 中。AP 隔离环境天然失效（现状亦然） |
| WS 出站 `network_connect` | `@kit.NetworkKit webSocket` 客户端，hello/ack 握手逻辑平移 | 低 |
| WS 入站 `network_start_listener` | **无官方 WS 服务端 API**，需在 `TCPSocket` 上自实现 RFC6455 握手 + 帧解析（估 300–500 行 ArkTS），或引入社区 ArkTS WS server 库 | **高**。见 §6.2 协议兼容决策 |
| 设备 ID/名称 | `util.generateRandomUUID` 落文件；`deviceInfo` 读设备名 | 低 |
| 6 种 `network:*` 事件 | 桥事件推送 | 低 |

### 5.5 HTTP 三命令

`download_file`（流式+进度事件+取消）、`cancel_download`、`service_http_request`（10s 超时、限 http/https、透传 headers/body）——`http.createHttp` / `request` 下载 API 全覆盖，**低复杂度**。`service_http_request` 是服务沙箱 `fetch` 权限的实现，必须保留（绕 CORS）。

### 5.6 系统桌面卡片（widget.rs + Kotlin AppWidget → FormKit 全新实现）

好消息：

- 鸿蒙卡片一张可声明多尺寸（`supportDimensions: 1x2/2x2/2x4/4x4`），**不需要 Android 三 receiver 子类的 hack**。
- 数据生产链路（`desktop-widget-runner.ts` 隐藏 iframe 跑 `logic.js` → `renderHtml` 离屏渲染 PNG 落盘 `cache/img/`）**100% 在前端/ArkWeb 内完成，原样保留**；只有最后推送一步换桥。

需要新实现（ArkTS）：

- `FormExtensionAbility` + `formProvider.updateForm`：卡片 UI 用 ArkTS 声明式**预定义三套模板**（lines/image/bigText，对应 RemoteViews 三布局），updateForm 传数据 + 模板选择。现有 `widget.json` 载荷协议语义不变。
- 图片：PNG 文件经 formProvider 图片机制推送（注意卡片图片内存限制，沿用现有 `decodeScaled` 降采样思路）。
- 点击跳转双通道映射：`postCardAction` router 事件拉起 EntryAbility（冷：want params 带 tapPath；热：emitter 通知 ArkWeb dispatch `amiba-widget-navigate`），语义与 Android `handleWidgetTap` 双通道一致。
- 选卡配置：ArkUI 卡片配置页按尺寸过滤（逻辑平移 `WidgetConfigActivity.kt`）。
- 刷新时机：现状是事件驱动推送（服务发布时），不依赖系统定时刷新，规避鸿蒙卡片刷新频率限制。

前端对应改动仅 `desktop-widget-store.ts` 的 `detectPlatform()==='android'` 分支扩展为 harmony，invoke 换桥。

### 5.7 其他平台能力

| 能力 | 鸿蒙对应 | 备注 |
|---|---|---|
| `setupWindowInsets`（systemBars/IME padding） | `windowStage.getMainWindow()` + `getWindowAvoidArea`，ArkUI 官方模式 | 语义对等，Android 的 targetSdk 35 痛点在鸿蒙不存在 |
| SAF 文件夹选取 + 持久授权（fileAccess） | `DocumentViewPicker` + `fileshare` 持久化授权 | **无 MANAGE_EXTERNAL_STORAGE 对等物**：「按路径直扫共享目录」降级为「picker 授权目录」模型，fileAccess 模块功能收窄 |
| `read_tombstone` 崩溃诊断 | 砍掉或改用自研 logger 记录（`faultLog` 对普通应用受限） | 低优先 |
| `tauri-plugin-android-installer` + `download_file` 更新链 | **整体下线** | AppGallery 分发，禁止应用内安装包自更新；更新检查改为「检测新版本 → 提示去应用市场」 |
| `plugin-opener` | 不需要 | 随更新链下线 |
| 后台服务（background-manager 隐藏 iframe） | **架构风险**，见 §6.4 | 前台可用；退后台受限 |
| 日志（logger.ts 自研） | 零改动（走 fs shim） | 前端 monkey-patch console 方案与平台无关 |

## 6. 关键技术风险与对策

### 6.1 FTS5 缺口（会话全文搜索）

鸿蒙 `relationalStore` 内置 SQLite **未启用 FTS5 扩展**，虚拟表/触发器不可用。三个选项：

| 选项 | 做法 | 取舍 |
|---|---|---|
| a. LIKE 退化（首期推荐） | `content LIKE '%kw%'` + JS 侧 snippet 高亮 | 会话量级小（千级消息）、`session_search` 低频，体验可接受；丢失 rank 排序 |
| b. 自建倒排索引 | 普通表维护 词→message_id 映射，insert 时更新 | 行为最接近现状，工作量翻倍，中文分词仍需自研 |
| c. NAPI 自编译 SQLite | 集成 [sqlite3_simple_ohos](https://github.com/SageMik/sqlite3_simple_ohos)（FTS5 + 中文/拼音分词 Simple 扩展的鸿蒙移植） | 搜索质量**反超现状**（现 unicode61 对中文分词差），但引入 .so + NAPI 构建链，留作二期优化 |

路线：首期 a，二期评估 c。

### 6.2 WebSocket 服务端 + 协议兼容决策

鸿蒙只有 WS 客户端 API。现有 LAN 互联协议是标准 WS 帧（tokio-tungstenite），**自实现服务端必须完整兼容 RFC6455**（握手 + 帧头/掩码/分片/ping-pong/关闭），否则鸿蒙端无法与桌面/Android 端互联，只能鸿蒙互鸿蒙。

- 决策：自实现 RFC6455（约 300–500 行，协议成熟无未知），保持全平台互通。**不可接受改私有协议**（会把 LAN 互联撕裂成两套生态）。
- 可在 PoC 阶段先验证 TCPSocket 监听 + 手工握手最小链路。

### 6.3 ArkWeb 服务沙箱兼容性（PoC 头号验证项）

项目核心机制，必须首批真机验证：

1. `iframe srcdoc` 渲染 + 多层 iframe `postMessage`（服务容器、后台 worker、`QuickPage` 的 `amiba-quick-touch` 触摸转发）。
2. iframe `sandbox` 属性行为 + 沙箱内 `localStorage`（服务数据存储是设计内行为）。
3. resource 协议下 `/libs/jade.css`、`/libs/vue.global.prod.js` 绝对路径解析。
4. `Blob` + `a.download`（日志/设置/ZIP 导出）——预计需桥接保存（ArkWeb 下载委托 `onDownloadStart`）。
5. `<input type=file>`（服务包/ZIP 导入）——`onShowFileSelector` 接 Picker。
6. 不可见 ArkWeb 实例的 JS 执行（后台 worker/卡片 runner 依赖）。

### 6.4 后台服务生命周期

Android 上隐藏 WebView 依附进程存活；鸿蒙应用退后台后 ArkWeb JS 冻结，background-manager 的服务后台运行**只在保活场景成立**。对策：首期声明「后台服务仅前台运行」（UI 明示），二期评估 `backgroundTaskManager` 长时任务类型是否覆盖（大概率不覆盖通用 JS 执行）。这是与 Android 版的功能性差距，需在发布说明中明示。

### 6.5 上架与合规

- AppGallery Connect 账号、证书/profile、隐私政策（AI 生成内容声明、第三方 LLM API 数据流向、局域网通信说明）。
- 禁止应用内下载安装包自更新 → 更新模块按 §5.7 收敛。
- 「AI 生成可执行应用」形态在应用市场审核中属敏感品类，预留审核沟通材料（沙箱隔离说明、权限模型文档——现有 `service-validator.ts` 与权限体系可直接引用为证据）。

## 7. 分阶段路线图（1 人估 9–14 周）

| 阶段 | 内容 | 出口标准 | 估期 |
|---|---|---|---|
| **0. PoC** | DevEco 工程骨架；ArkWeb 加载 dist；javaScriptProxy invoke/emit 双向桥；fs shim 最小集（读写 filesDir）；§6.3 沙箱验证清单全过；TCPSocket 手工 WS 握手最小链路 | 真机上聊天页可跑、配置可持久化、AI 生成的服务可在沙箱运行 | 1–2 周 |
| **0'. 并行探针** | 编译 richerfu/tauri OHOS fork，跑 tauri-demo 上真机 | 明确方案 B 是否可行，不行即弃 | ≤1 周 |
| **1. 核心闭环** | fs shim 全集 + 前端 23 文件机械替换；platform-bridge 统一探测；session-db（LIKE 退化）；HTTP 三命令；`web_fetch`（ArkWeb 池） | AI 生成服务全流程（创建/存储/运行/校验）在鸿蒙真机闭环 | 2–3 周 |
| **2. 平台能力** | web_browse 全家桶（click/input/content/截图）；PickerBridge；主题/技能/记忆文件体系；导出/导入桥接；edge-to-edge | 设置页全功能、web 工具可用 | 2–3 周 |
| **3. 网络与卡片** | UDP 发现 + WS 服务端 + 房间/服务分享/技能分享；FormKit 卡片三模板 + tap 双通道 + 配置页 | LAN 与 Android/桌面端互通；卡片可添加/刷新/跳转 | 3–4 周 |
| **4. 收尾上架** | 签名打包、隐私协议、更新提示、发布说明（后台服务限制明示）、审核材料 | 上架 AppGallery | 1–2 周 |

## 8. 待拍板决策点

1. **方案 B 探针**：是否花 1 周验证社区 Tauri OHOS fork？（建议：做，成本固定，潜在收益是 Rust 层整体保留）
2. **FTS 路线**：首期 LIKE 退化 → 二期 sqlite3_simple_ohos（NAPI）？（建议：是）
3. **WS 服务端**：确认自实现 RFC6455 保持互通（建议：确认，无替代）
4. **后台服务**：接受「鸿蒙版仅前台运行」的功能差距？（建议：接受，二期再评）
5. **dist 加载**：rawfile 内置（建议）vs filesDir 解压？
6. **更新机制**：应用内更新链下线，仅保留版本检测 + 跳转应用市场（建议）

## 9. 代码组织与维护策略

- **前端单一代码库**：`platform-bridge.ts` / `native-fs.ts` 进主仓，桌面/Android/鸿蒙共用；新增平台仅 `detectHost()` 加一个分支。
- **鸿蒙工程**：主仓新建 `harmony/`（DevEco 工程，arkts 壳 + 原生服务层），`dist/` 作为构建输入拷入 rawfile；与 `src-tauri/` 平级，互不干扰。
- **协议单一事实源**：31 条命令的 TS 类型定义抽到 `src/types/native-bridge.ts`，ArkTS 侧按此实现；新增命令双端同步。
- **src-tauri 保留**：桌面 + Android 继续由 Tauri 服务，不受影响；Android 专属链（JNI/Kotlin/widget.rs）不进鸿蒙工程。
- **文档同步**：本文件随实施进度更新；各阶段落地后按项目惯例补 `docs/harmonyos.md` 架构文档并更新 AGENTS.md。

## 附：外部事实来源

- Tauri 鸿蒙支持诉求（未支持）：[tauri-apps/tauri#12640](https://github.com/tauri-apps/tauri/issues/12640)
- 社区 Tauri OHOS 原型：[richerfu/tauri-demo](https://github.com/richerfu/tauri-demo)、[移植实战总结](https://blog.csdn.net/qq8864/article/details/161751525)
- 鸿蒙 FTS5 缺口与移植库：[SageMik/sqlite3_simple_ohos](https://github.com/SageMik/sqlite3_simple_ohos)、[华为开发者论坛讨论](https://developer.huawei.com/consumer/cn/forum/topic/0207165360351130934)
- WS 服务端需自实现：[IT营鸿蒙问答](https://bbs.itying.com/topic/68a5631b2cb460013cc12b56)
- ArkWeb 桥能力（javaScriptProxy/runJavaScript/本地加载）：[华为官方文档](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides-V5/web-page-loading-with-web-components-V5)、[拍拍贷 H5 容器实践](https://segmentfault.com/a/1190000045421559)
