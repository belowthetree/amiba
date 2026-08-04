# 变形虫 Amiba — 鸿蒙壳（HarmonyOS NEXT）

Vue 3 前端（主仓 `dist/` 产物）+ ArkTS 薄壳（ArkWeb 容器 + 原生服务层）。
迁移方案与命令映射表见主仓 `docs/harmonyos-migration.md`；桥协议单一事实源见主仓 `src/types/native-bridge.ts`。

## 状态：PoC 骨架

已实现：

- `javaScriptProxy` 双向桥（H5 `window.__AMIBA_HARMONY__.invoke(cmd, json)` ⇄ ArkTS `Dispatcher`；原生事件经 `__amiba_harmony_emit__` 推送）
- `WebSchemeHandler` 自定义协议离线包（`amiba://local/*` → rawfile，页面与子资源全部由 `RawfileScheme.ets` 喂数据；旧 `resource://` + `onInterceptRequest` 方案已被新 SDK 移除）
- `fs_*` 文件系统命令族（对应 `@tauri-apps/plugin-fs` 兼容 shim，沙箱根 = `filesDir`/`cacheDir`）
- `get_app_info`（应用版本）

未实现（按路线图逐步补齐，H5 调用会得到「命令未实现」错误）：

- `web_*` 浏览器引擎、`search_sessions` 等会话库、`network_*` 局域网、`download_file`/`service_http_request`、FormKit 卡片

> ⚠️ 本工程文件为手写骨架，未经 DevEco 同步验证。若打开后同步失败，用 DevEco Studio
> 新建一个 Empty Ability 工程，再把 `entry/src/main/ets/` 下的源码与 `module.json5` 的
> 权限/ability 配置合并进去。

## 环境

- DevEco Studio 5.0+（HarmonyOS NEXT SDK，API 12+）
- 真机或模拟器：HarmonyOS NEXT 5.0+

## 构建运行

```bash
# 1. 主仓构建前端产物
npm run build

# 2. 同步 dist 到鸿蒙工程 rawfile
npm run harmony:sync

# 3. 用 DevEco Studio 打开本目录（harmony/），自动签名（调试）后运行到真机
```

发布签名：在 DevEco 中配置 AppGallery Connect 证书/profile（`build-profile.json5` 的 `signingConfigs` 当前留空）。

## 目录

```
harmony/
├── AppScope/                        # 应用级配置（bundleName=com.amiba.app）
├── entry/src/main/
│   ├── module.json5                 # ability + INTERNET 权限
│   ├── ets/
│   │   ├── entryability/EntryAbility.ets   # 入口 ability（初始化 fs 目录）
│   │   ├── pages/Index.ets                 # ArkWeb 容器页（加载 resource://rawfile/index.html）
│   │   └── bridge/
│   │       ├── HarmonyBridge.ets           # javaScriptProxy 桥对象（invoke/emitToWeb）
│   │       ├── Dispatcher.ets              # 命令分发（未实现命令显式报错）
│   │       ├── FsCommands.ets              # fs_* 命令族（fileIo）
│   │       └── AppCommands.ets             # get_app_info
│   └── resources/rawfile/           # 前端产物同步到根（index.html、assets/、libs/…，sync 脚本填充，不入库）
└── scripts/sync-dist.mjs            # npm run harmony:sync
```

## PoC 真机验证清单（对照迁移文档 §6.3）

- [ ] 聊天页渲染 + 配置持久化（fs 桥读写 `filesDir/amiba/`）
- [ ] AI 生成服务在 `iframe srcdoc` 沙箱运行、多层 iframe `postMessage`
- [ ] 服务沙箱内 `localStorage`
- [ ] `/libs/jade.css` 等绝对路径资源在 resource 协议下的解析
- [ ] 软键盘弹出时输入框避让（对应 Android IME inset 行为）
- [ ] `a.download` 导出（预期需 `onDownloadStart` 桥接）、`<input type=file>` 导入（预期需 `onShowFileSelector`）
- [ ] 前端直接 fetch LLM API 的 CORS 行为（resource:// 源）
- [ ] 不可见 ArkWeb 实例 JS 执行（后台 worker/卡片 runner 依赖）
