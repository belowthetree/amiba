# P2 — 服务插件化（进行中）

> 对应路线：`docs/plugin/plugin-migration-roadmap.md` 的 P2。
> 策略：每步拆 1–2 个服务插件，保持 `legacy-bootstrap` 可运行；全部步骤完成后再进入 P3 UI Slot 化。

## 步骤清单

| 步骤 | 内容 | 状态 |
| --- | --- | --- |
| 1 | 拆出 `@amiba/storage` 与 `@amiba/settings` 服务插件 | ✅ 已验证 |
| 2 | 拆出 `@amiba/tool-registry` / `@amiba/toolsets` 服务 | ✅ 已验证 |
| 3 | 拆出 `@amiba/model-providers` 与 `@amiba/credentials` | ✅ 已验证 |
| 4 | 拆出 `@amiba/session` 与 `@amiba/memory` | ✅ 已验证 |
| 5 | 拆出 `@amiba/skills` 技能群 | ✅ 已验证 |
| 6 | 拆出 `@amiba/service-runtime`（registry / bridge / service-tools） | ✅ 已验证 |
| 7 | 拆出网络 / Widget / 后台服务插件 | 🔄 待验证 |
| 8 | `legacy-bootstrap` 瘦身为“仅挂载 + 生命周期” | ⬜ |

## 第 1 步目标

- `ctx.get('storage')`：现有 `config/storage.ts` 全部能力。
- `ctx.get('settings')`：`init/get/update/state`，内部继续使用现有 `settings` reactive 单例。
- `legacy-bootstrap` 不再直接调用 `initStorage()` / `initConfig()`，改为依赖服务。
- 启动顺序仍为 storage → config → logger → 后续业务，与改造前一致。
