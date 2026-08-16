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

## 一句话结论

Amiba 采用与 DeepSeek Harness 相同的“Cordis 式内核 + YAML 装配 + npm 插件包 + Host/Client 双半插件 + Slot 界面注册”模型，并在此基础上补齐 DSH 目前较弱的部分：**统一的插件清单（manifest）、能力权限系统、Slot 契约类型化、内核自身最小化与迁移路线**。最终目标：除极小的内核（加载器、服务容器、事件总线、配置装配、进程入口）外，**所有业务功能与所有界面都由插件提供，且一等公民插件与第三方插件走完全相同的机制，不留任何硬编码特例。**
