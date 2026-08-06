# 变形虫 Amiba — 鸿蒙壳（HarmonyOS NEXT）

Vue 3 前端（主仓 `dist/` 产物）+ ArkTS 薄壳（ArkWeb 容器 + 原生服务层）。
迁移方案与命令映射表见主仓 `docs/harmonyos-migration.md`；桥协议单一事实源见主仓 `src/types/native-bridge.ts`。

## 状态：PoC 骨架

已实现：

- `javaScriptProxy` 双向桥（H5 `window.__AMIBA_HARMONY__.invoke(cmd, json)` ⇄ ArkTS `Dispatcher`；原生事件经 `__amiba_harmony_emit__` 推送）
- `WebSchemeHandler` 自定义协议离线包（`amiba://local/*` → rawfile，页面与子资源全部由 `RawfileScheme.ets` 喂数据；旧 `resource://` + `onInterceptRequest` 方案已被新 SDK 移除）
- `fs_*` 文件系统命令族（对应 `@tauri-apps/plugin-fs` 兼容 shim，沙箱根 = `filesDir`/`cacheDir`）
- 会话库 8 命令（`search_sessions`/`index_message`/`index_message_batch`/`get_session`/`list_sessions_cmd`/`delete_session_cmd`/`scroll_session`/`read_session_cmd`，relationalStore + LIKE 退化搜索，对应 Tauri `db.rs`，FTS5 缺口按迁移文档 §6.1 方案a）
- `get_app_info`（应用版本）

未实现（按路线图逐步补齐，H5 调用会得到「命令未实现」错误）：

- `web_*` 浏览器引擎、`network_*` 局域网、`download_file`/`service_http_request`、FormKit 卡片

> ⚠️ 本工程文件为手写骨架，未经 DevEco 同步验证。若打开后同步失败，用 DevEco Studio
> 新建一个 Empty Ability 工程，再把 `entry/src/main/ets/` 下的源码与 `module.json5` 的
> 权限/ability 配置合并进去。

## 环境

- DevEco Studio 5.0+（HarmonyOS NEXT SDK，API 12+）
- 真机或模拟器：HarmonyOS NEXT 5.0+

## 构建运行

```bash
# 0. 首次克隆：复制构建配置模板（签名配置不入库，见下）
cp build-profile.json5.template build-profile.json5

# 1. 主仓构建前端产物
npm run build

# 2a. 命令行一键构建（sync dist → rawfile + assembleHap，产物见 entry/build/default/outputs/）
npm run harmony:build

# 2b. 打 App Pack 发布包（assembleApp，产物见 build/outputs/default/*.app，附 MD5 可用 md5sum 生成）
npm run harmony:build:app

# 2c. 或用 DevEco Studio 打开本目录（harmony/），自动签名（调试）后运行到真机
```

**CI**：`.github/workflows/release-harmony.yml` 在版本变更时自动构建 `.app`（含 MD5）并上传
GitHub Release。鸿蒙 SDK 无法无头安装，工作流跑在**自托管 Windows runner**（装有 DevEco 的
机器）上；一次性准备（注册 runner、配置 `HARMONY_BUILD_PROFILE_BASE64` secret）见工作流文件头注释。

`harmony:build` 脚本内已设置 `DEVECO_SDK_HOME` 并把 DevEco JBR 加入 `PATH`
（release 签名需要 JBR 的 JDK 版本，系统 java 会报 keystore 版本错误），均为本机 DevEco
默认安装路径，非默认安装需改脚本。

**hvigor 依赖布局（勿用 hvigorw.js）**：`node_modules/@ohos/hvigor` 与
`node_modules/@ohos/hvigor-ohos-plugin` 是指向 DevEco 安装目录
（`tools/hvigor/` 下同名目录）的 **junction**。这样 IDE 构建与命令行构建解析到同一份模块，
实例唯一；若换成本地实体副本，hvigorfile.ts 加载的插件与 IDE 的 hvigor 核心会成为两个模块实例，
构建报 `00302013 The root node is not yet available for build`。`harmony/hvigorw.js` 的全局
workspace 机制在本目录布局下会生成坏 junction，不要使用。DevEco 升级/换装到别的路径后需重建
这两个 junction：

```bash
cd harmony/node_modules/@ohos
rmdir hvigor hvigor-ohos-plugin   # cmd 执行，或用资源管理器删除
mklink /J hvigor "<DevEco>\tools\hvigor\hvigor"
mklink /J hvigor-ohos-plugin "<DevEco>\tools\hvigor\hvigor-ohos-plugin"
```

**签名配置不入库**：`build-profile.json5` 含本地密钥密文与证书路径，已加入 `.gitignore`。
仓库只跟踪 `build-profile.json5.template`（`signingConfigs: []`）。首次克隆后复制模板，
再用 DevEco「File → Project Structure → Signing Configs → Automatically generate signature」
自动回填调试签名（自动签名会直接写回 `build-profile.json5`，属本地文件不会入库）。
发布签名：在 DevEco 中配置 AppGallery Connect 证书/profile 到同一文件。

## 目录

```
harmony/
├── AppScope/                        # 应用级配置（bundleName=com.amiba.app）
├── entry/src/main/
│   ├── module.json5                 # ability + INTERNET 权限
│   ├── ets/
│   │   ├── entryability/EntryAbility.ets   # 入口 ability（初始化 fs 目录 + 会话库）
│   │   ├── pages/Index.ets                 # ArkWeb 容器页（加载 resource://rawfile/index.html）
│   │   └── bridge/
│   │       ├── HarmonyBridge.ets           # javaScriptProxy 桥对象（invoke/emitToWeb）
│   │       ├── Dispatcher.ets              # 命令分发（未实现命令显式报错）
│   │       ├── FsCommands.ets              # fs_* 命令族（fileIo）
│   │       ├── DbCommands.ets              # 会话库 8 命令（relationalStore，LIKE 退化搜索）
│   │       └── AppCommands.ets             # get_app_info
│   └── resources/rawfile/           # 前端产物同步到根（index.html、assets/、libs/…，sync 脚本填充，不入库）
└── scripts/sync-dist.mjs            # npm run harmony:sync
```

## PoC 真机验证清单（对照迁移文档 §6.3）

- [x] 聊天页渲染 + 配置持久化（fs 桥读写 `filesDir/amiba/`）✅ 真机截图确认，配置跨启动保留
- [x] AI 生成服务在 `iframe srcdoc` 沙箱运行、多层 iframe `postMessage` ✅ `user.music_player` 的 music-controls 浮窗真机渲染运行
- [x] 服务沙箱内 `localStorage` ✅ CDP 实测主文档与 srcdoc iframe 内 localStorage 读写均正常
- [x] `/libs/jade.css` 等绝对路径资源在 resource 协议下的解析 ✅ rawfile 协议无加载失败
- [ ] 软键盘弹出时输入框避让（对应 Android IME inset 行为）—— avoidArea → 根 Stack padding 已实现（EntryAbility.ets），需手动点输入框确认
- [x] `a.download` 导出（预期需 `onDownloadStart` 桥接）、`<input type=file>` 导入（预期需 `onShowFileSelector`）✅ 已实现（WebDownloadDelegate 落盘 downloads/、picker 拷贝入 uploads/ 回传 file:// URI），交互路径待手动抽查
- [x] 前端直接 fetch LLM API 的 CORS 行为（resource:// 源）✅ 启动 API 可用性检查真机通过
- [x] 不可见 ArkWeb 实例 JS 执行（后台 worker/卡片 runner 依赖）✅ web_fetch WebView 路径（隐藏 480×360 实例）真机抓取成功

## 路由坑（已修复）

Web src 必须是 `amiba://local/`（pathname `/`），不能是 `amiba://local/index.html`——
vue-router `createWebHistory` 按 pathname 匹配，`/index.html` 无路由 → RouterView 空白页。
- [ ] 不可见 ArkWeb 实例 JS 执行（后台 worker/卡片 runner 依赖）
