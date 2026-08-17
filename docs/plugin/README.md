# Amiba 插件化方案文档

本目录是 Amiba 全量插件化改造的架构方案文档集。

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [deepseek-harness-plugin-research.md](deepseek-harness-plugin-research.md) | DeepSeek Harness 插件化方案调研：Cordis 装配、Host/Client 插件、UI Slot、CLI、市场与安全 |
| [plugin-architecture.md](plugin-architecture.md) | Amiba 目标架构：内核、装配模型、插件契约、生命周期、目录布局 |
| [plugin-extension-points.md](plugin-extension-points.md) | Amiba 全部 Host 服务扩展点与 UI Slot 清单（功能、界面全插件化的接口面） |
| [plugin-development-guide.md](plugin-development-guide.md) | 插件开发、打包、安装、调试、发布与示例 |
| [plugin-security-and-marketplace.md](plugin-security-and-marketplace.md) | 权限模型、安全边界、插件市场与供应链防护 |
| [plugin-migration-roadmap.md](plugin-migration-roadmap.md) | 从现有 Amiba 单体到“一切皆插件”的分阶段迁移与验收标准 |
| [p0/README.md](p0/README.md) | **P0 执行区**：模块/接口/耦合盘点、基线计划、关键 ADR |
| [p1/README.md](p1/README.md) | **P1 执行区**：内核抽出步骤与进度（已完成） |
| [p2/README.md](p2/README.md) | **P2 执行区**：服务插件化步骤与进度（已完成） |
| [p3/README.md](p3/README.md) | **P3 执行区**：UI Slot 化步骤与进度（已完成） |
| [p4/README.md](p4/README.md) | **P4 执行区**：插件 SDK / CLI / 脚手架（已完成） |
| [p5/README.md](p5/README.md) | **P5 执行区**：安全 / 插件管理 / 市场（进行中） |
| [packaged-app-plugin-download.md](packaged-app-plugin-download.md) | 已打包 App 的插件下载/安装方案（沙箱服务 + 预编译宿主插件包） |

## P0 重要修正（已生效）

P0 对实际 Amiba 源码盘点后确认：**Amiba 是 Vue 3 SPA + Tauri，没有 Node Host 进程。** 因此原方案中的 Node Host/Client 双半插件、`~/.amiba/profiles` 与 npm require 运行时不能照搬，已由 `p0/ADR/0001-runtime-model.md` 修正为 **浏览器原生插件内核 + Vite 装配 + Tauri 能力桥**。后续实现以 P0 ADR 为准。

## 一句话结论

Amiba 采用与 DeepSeek Harness 相同的“Cordis 式内核 + YAML 装配 + 插件清单 + Slot 界面注册”思想，并适配为 **Vue/Tauri 浏览器内核形态**；同时补齐 DSH 较弱的部分：统一 manifest、能力权限、类型化 Vue Slot、内核最小化与迁移路线。最终目标：除极小内核（加载器、服务容器、事件总线、权限、日志、平台桥）外，**所有业务功能与所有界面都由插件提供，一等公民插件与第三方插件走完全相同的机制。**
