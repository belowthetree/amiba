---
name: web-browsing
description: Guidance for using web_fetch and web_browse tools — search engines, forms, multi-click patterns, platform notes
---

# web-browsing

使用 `web_fetch` 和 `web_browse` 工具时的操作策略。

## 核心原则

### 1. navigate 是最可靠的操作
能直接拼 URL 就不要填表+点击。例：搜知乎用 `navigate → https://www.bing.com/search?q=知乎` 比 `input_text` + `click` 可靠得多。

### 2. 每次交互后必须 get_content 验证
不要假设操作成功。检查：URL 是否变了、DOM 是否变了、期望的内容是否出现。

### 3. 搜索框通常需要两次点击
Bing、Google 等搜索引擎：第一次点击出联想下拉框，**第二次点击同一按钮**才真正提交表单跳转。流程：
```
input_text → 输入关键词
click → 第一次点击（出联想词，stabilized）
click → 第二次点击（提交表单，navigated）
get_content → 确认已跳转到搜索结果页
```

### 4. 选择器优先用 #id
- `#id` 最稳定
- `.class` 次之
- 避免模糊选择器如 `button`、`input`
- 先用 `get_content` 浏览页面结构，再选精确选择器

### 5. click 返回 stabilized → 再点一次
`stabilized` 表示 DOM 变化了但 URL 没变——说明页面拦截了点击来展示 UI（下拉框/弹窗等）。**再点同一元素即可。**

### 6. 两次不行就 navigate 兜底
交互两次仍不跳转 → 放弃交互，拼 URL 直接 navigate。搜索引擎通用格式：`https://<domain>/search?q=<关键词>`

## 反模式
- ❌ 能拼 URL 却非要填表+点击
- ❌ 不验证 get_content 就假设成功
- ❌ 点一次失败就放弃——再点一次
- ❌ 对需登录/交互的页面用 web_fetch
