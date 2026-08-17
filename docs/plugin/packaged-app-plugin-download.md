# 已打包 App 的插件下载方案

> 已实现核心：统一 `.amiba-plugin` 包（宿主插件 + 可选沙箱服务）、运行时 `__AMIBA_MODULE_LOADER__`、安装/卸载/恢复、市场页本地导入、构建脚本。远程下载与生产签名仍待接入。

## 0. 现状结论

当前本地插件链路（`src/plugins-local/*` + `amiba.plugins.yaml` + `plugin:sync`）是**开发期/构建期**能力：

- 插件源码由 Vite 编译进应用；
- 打包后的 App 不包含 Node、不能运行 `npm`/`vite`/`vue-tsc`；
- 因此已打包 App **不能直接下载源码插件并即时编译**。

要给已打包 App 增加“下载插件扩展”，必须把插件从“源码”变成“浏览器可执行包”，并增加运行时安装器。下面给出现阶段可直接用、以及目标形态两套方案。

---

## 1. 立即可用：把扩展作为“沙箱服务”下载

Amiba 已经具备运行时下载/安装服务包的基础：

- `ServiceRegistry` 会扫描 `{AppData}/amiba/services/<id>/manifest.json`；
- `ServicePackage` = `manifest.json + files`；
- `service-container` 用 iframe 沙箱运行；
- 权限由服务 manifest 控制，天然隔离。

因此最简单的插件分发：

```
插件作者发布:
  manifest.json + index.html/style.css/app.js

App 内:
  市场页 → HTTP(S) 下载 zip/json
       → 校验 sha256 + 可选签名
       → 写入 services/<id>/
       → registerService() + storeServicePackage()
       → 刷新服务列表
```

优点：不用动态执行宿主代码，安全边界与现有用户服务一致。
缺点：只能扩展“服务形态”的功能，不能新增宿主页面、设置页签或宿主工具。

---

## 2. 目标形态：预编译宿主插件包

### 2.1 包格式

推荐 `.amiba-plugin`（zip），内容：

```
amiba.plugin.json        # apiVersion / id / kind / permissions / sdkVersion
plugin.js                # 预编译浏览器 bundle
assets/                  # 图标、语言包等静态资源
signature.json           # 可选签名（Ed25519）
```

`plugin.js` 采用类似 DSH 的模块装载协议，而不是浏览器裸 ESM：

```js
window.__AMIBA_MODULE_LOADER__.load({
  id: "example-hello",
  factory: (require) => {
    const { defineComponent, ref } = require('vue')
    const sdk = require('@amiba/sdk')
    // ...
    return {
      name: '@amiba/example-hello',
      inject: ['pageRegistry', 'uiSlots'],
      apply(ctx) { /* ... */ },
    }
  }
})
```

为什么用 `__AMIBA_MODULE_LOADER__`：

- 打包后的页面无法解析裸模块说明符 `import ... from 'vue'`；
- 运行时 loader 可以把 `vue`、`@amiba/sdk`、`@amiba/kernel` 等平台模块注入 `require`；
- 避免插件各自打包一份 Vue/内核，防止双实例和状态分裂。

### 2.2 运行时装载流程

```
市场页选择插件
  → Rust download_file 下载到 {AppData}/amiba/cache/downloads/
  → 解压 zip
  → 校验 manifest.apiVersion / sdkVersion
  → 校验 sha256 + 签名（如有）
  → 拷贝到 {AppData}/amiba/plugins/<id>/
  → 写 installed.json（version/hash/permissions/installedAt）
  → PluginManager 读取 plugin.js 文本
  → 执行 window.__AMIBA_MODULE_LOADER__.load(...)
  → 得到 { name, inject, provides, apply }
  → kernelState.loader.load([PluginDefinition])
  → pageRegistry / uiSlots / toolRegistry 动态生效
```

关键点：

| 项 | 方案 |
| --- | --- |
| 下载 | 复用 Rust `download_file`（已有，绕过 CORS） |
| 解压 | 引入或实现 zip 解压（项目已有 JSZip，可直接用） |
| 文件读取 | `native-fs.readTextFile` |
| 模块装载 | `window.__AMIBA_MODULE_LOADER__.load` |
| 平台模块注入 | `vue`、`vue-router`、`pinia`、`@amiba/sdk`、内核服务类型 |
| 生命周期 | 复用现有 `KernelLoader.load/unload/reload` |
| 页面/路由 | 复用 `pageRegistry` + `ui-routes` 动态路由 |
| UI Slot | 复用 `uiSlots` 动态注册 |
| 工具 | 复用 `toolRegistry` |
| 持久化 | `{AppData}/amiba/plugins/installed.json`，启动时恢复 |
| 签名 | 内置 Ed25519 公钥；第三方插件无内置签名时“用户确认 + 指纹展示” |
| 权限 | 安装前展示 `permissions.allow/deny`；用户可拒绝单项 |

### 2.3 安装后的重启恢复

App 启动时：

```
initStorage()
  → PluginManager.restoreInstalledPlugins()
  → 扫描 {AppData}/amiba/plugins/<id>/plugin.js
  → 哈希校验
  → loader.load([...])
```

不需要用户重新构建。

---

## 3. 安全模型

| 层级 | 措施 |
| --- | --- |
| 网络 | 仅 HTTPS；域名白名单；下载大小上限；超时 |
| 完整性 | 全文件 sha256；`installed.json` 记录 hash，启动校验 |
| 签名 | 官方插件内置公钥；社区插件显示签名者/指纹，用户显式信任 |
| 权限 | 安装前权限摘要；用户可 deny；运行时 PermissionManager 审计 |
| 隔离 | 高风险插件提示使用服务沙箱，而不是宿主 bundle |
| 回滚 | 安装前备份旧版本；启动失败自动禁用并回滚 |
| 卸载 | 删除插件目录 + loader 卸载 + pageRegistry/uiSlots/toolRegistry 自动清理 + 移除 installed.json 记录 |

---

## 4. 市场发现

建议复用 DSH 市场模式：

```
静态 registry.json（GitHub Release / CDN）
  → App 拉取并展示
  → 每项含：
      id / version / sdkVersion / permissions
      sha256 / signature
      downloadUrl / homepage
  → 市场页卡片：
      安装 / 更新 / 卸载 / 权限摘要 / 已安装状态
```

市场页本身可作为内置 `ui-marketplace` 的升级版，或独立页面插件。

---

## 5. 建议落地顺序

| 阶段 | 交付 | 依赖 |
| --- | --- | --- |
| A | 服务包远程下载安装（复用现有服务模型） | 小 |
| B | `__AMIBA_MODULE_LOADER__` + 运行时 loader | A 完成 |
| C | `.amiba-plugin` 包构建工具 | B 完成 |
| D | 签名 + installed.json + 启动恢复 + 回滚 | C 完成 |
| E | 市场 registry + 卡片 UI | D 完成 |
| F | 权限摘要与审批流 | 可与 D 并行 |

---

## 6.1 当前已实现

- 统一包格式 `manifest.json + plugin.js + plugin.css? + service/* + checksums.json`。
- 运行时装载器 `window.__AMIBA_MODULE_LOADER__.load`。
- `PluginManagerService.installFromFile / uninstall / restore`。
- 市场页“导入 .amiba-plugin 包”按钮。
- 构建命令：`npm run plugin:package -- <pluginDir>`。
- 示例插件 `src/plugins-local/example-hello` 已带 `service/` 部分，可打包验证。

## 7. 结论

**已打包 App 下载插件，正确路径是：预编译浏览器插件包 + 运行时模块装载器 + 签名安装器 + 市场页。**  
在此之前，最快的可用路径是把插件发布为沙箱服务包，复用现有 `ServiceRegistry` / `ServicePackage` 安装链路。
