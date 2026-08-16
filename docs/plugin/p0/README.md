# P0 — 现状盘点与基线

> 状态：P0 完成（盘点/ADR 已落盘；用户确认本次未改动功能、所有功能正常；命令耗时/用例数等详细指标未回填，不阻塞 P1）
> 对应路线：`docs/plugin/plugin-migration-roadmap.md` 的 P0。
> 盘点快照：Amiba v0.10.4，Vue 3 + Vite + TypeScript + Tauri 2。

## P0 目标

1. 摸清当前功能、界面、原生能力、接口与耦合。
2. 把“DSH 式插件化方案”校正到 Amiba 的真实技术栈（浏览器 SPA + Tauri，无 Node Host 进程）。
3. 定下内核边界、插件格式、UI Slot、权限目录四个关键 ADR。
4. 建立可重复执行的基线（构建 / 类型检查 / 单测 / 手工冒烟），后续每个阶段都必须回到该基线。

## 本目录

| 文档 | 内容 | 状态 |
| --- | --- | --- |
| [module-inventory.md](module-inventory.md) | 全部模块盘点、五类归属、目标插件包映射 | ✅ 已完成初版 |
| [interface-inventory.md](interface-inventory.md) | 现有对外接口/注册点/原生命令盘点 | ✅ 已完成初版 |
| [coupling-findings.md](coupling-findings.md) | 阻碍插件化的耦合与风险清单 | ✅ 已完成初版 |
| [baseline-and-test-plan.md](baseline-and-test-plan.md) | 基线命令、冒烟清单、结果记录模板 | ✅ 功能回归已确认（详细指标待补） |
| [ADR/0001-runtime-model.md](ADR/0001-runtime-model.md) | 适配 Vue/Tauri 的插件运行时模型 | ✅ 已决策 |
| [ADR/0002-kernel-boundary.md](ADR/0002-kernel-boundary.md) | 内核最小边界 | ✅ 已决策 |
| [ADR/0003-plugin-manifest.md](ADR/0003-plugin-manifest.md) | 插件清单格式 | ✅ 已决策 |
| [ADR/0004-ui-slots-and-permissions.md](ADR/0004-ui-slots-and-permissions.md) | UI Slot 与权限目录 | ✅ 已决策 |

## P0 关键结论（先读这个）

1. **Amiba 不是 Node 服务端程序，而是 Vue SPA + Tauri。** 原方案中的“Node Host 半 / npm require / `~/.amiba/profiles` / `dsh plugin`”不能照搬，必须映射为“浏览器插件运行时 + Vite 构建注入 + Tauri 能力桥”。见 ADR-0001。
2. **Amiba 已经有两个很好的窄腰，应当复用而不是重造：**
   - `ToolRegistry`：所有 AI 工具已经注册制。
   - `ServiceRegistry` + JSBridge：用户生成的小应用已经是沙箱 iframe 内容插件。
   插件化改造要解决的是“宿主自身功能/页面”的单体问题，不是替换这两个窄腰。
3. **内核候选只有：插件装配、依赖注入、生命周期、事件、权限仲裁、日志。** 存储、平台桥、路由、i18n、主题都应以内核服务或一等插件形态存在。见 ADR-0002。
4. **首批“黑盒插件”边界已经可划：** AI/会话/记忆、Skill、工具、用户服务运行时、网络、Widget、主题、页面。每个先整包迁成插件，后续再拆内部扩展点。
5. **当前 Slot 系统是 HTML 字符串 + innerHTML，只能留给沙箱服务使用；宿主插件 UI 必须另建类型化 Vue Slot 注册表。** 现有 4 个 slot 是第一批映射对象。见 ADR-0004。
6. **基线结论：功能正常。** 本次 P0 只新增/更新 `docs/`，未改动任何 `src/`、`src-tauri/`、构建配置或运行时代码；用户已确认所有功能正常。命令耗时、用例数等详细指标可后续回填，不阻塞 P1。

## P0 退出标准

- [x] 模块盘点与接口盘点完成初版
- [x] 耦合与风险清单完成初版
- [x] 4 个关键 ADR 已决策
- [x] 功能回归确认：用户确认本次未改动功能、所有功能正常
- [ ] `npm run build`、`npm test`、`npx vue-tsc -b` 的耗时/用例数等详细数值回填（可选，不阻塞 P1）
- [ ] 桌面 `npm run dev` 与 Tauri `cargo tauri dev` 手工冒烟清单逐项打勾回填（可选，不阻塞 P1）
