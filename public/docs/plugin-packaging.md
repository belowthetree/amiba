---
title: 插件打包与运行时安装
description: .amiba-plugin 预编译包：构建、校验、签名、运行时导入与恢复。
keywords:
  - 打包
  - 插件包
  - amiba-plugin
  - 安装
  - 签名
  - 校验
category: platform
---

# 插件打包与运行时安装

## 统一包格式

`.amiba-plugin` 是 zip，宿主插件与沙箱服务可以二合一：

```
manifest.json       # apiVersion/version/inject/provides/permissions/service
plugin.js           # 预编译宿主 bundle
plugin.css          # 可选
service/            # 可选沙箱服务文件
checksums.json      # 全部文件 sha256
```

## 构建

```bash
npm run plugin:package -- <pluginDir>
# 输出: dist-plugins/<id>-<version>.amiba-plugin.zip
```

构建器会：

1. 用 Vite 编译 `src/index.ts` 为 CJS bundle；
2. 用 `window.__AMIBA_MODULE_LOADER__.load` 包装；
3. 注入平台模块：`vue` / `vue-router` / `pinia` / `@amiba/sdk` / `@amiba/kernel`；
4. 拷贝可选 `service/` 目录；
5. 生成 `checksums.json`。

## 运行时安装

打包后的 App：

```
设置 → 本地插件 → 导入 .amiba-plugin 包
```

安装器会：

1. 解压并校验 `checksums.json`；
2. 宿主部分安装到 `amiba/plugins/<id>/`；
3. 服务部分安装到 `services/<id>/`；
4. 写 `installed.json`；
5. 执行 `plugin.js` 并 `loader.load()`。

宿主部分即时生效；服务部分重启后进入服务列表。

## 校验与签名

```bash
npm run plugin:verify
npm run plugin:verify-signature -- <pluginDir>
npm run plugin:sign -- <pluginDir>
```

## 恢复

启动时 `pluginManager.restore()` 自动扫描 `installed.json`，校验后重新装配宿主插件。
