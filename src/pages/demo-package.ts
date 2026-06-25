// Demo service package — multi-file web app format
import type { ServicePackage } from '../types/service'

export const DEMO_PACKAGE: ServicePackage = {
  manifest: {
    id: 'user.hello_world',
    name: 'Hello World',
    version: '1.0.0',
    description: '基础示例 — 计数器',
    permissions: ['notification'],
  },
  files: [
    {
      path: 'index.html',
      content: [
        '<!DOCTYPE html>',
        '<html lang="zh">',
        '<head>',
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '<link rel="stylesheet" href="style.css">',
        '</head>',
        '<body>',
        '<div class="card">',
        '  <div class="title">Hello World</div>',
        '  <p id="counter">点击次数: 0</p>',
        '  <button class="btn" onclick="handleClick()">点我</button>',
        '</div>',
        '<script src="app.js"></script>',
        '</body>',
        '</html>',
      ].join('\n'),
    },
    {
      path: 'style.css',
      content: [
        'body { font-family: -apple-system, sans-serif; padding: 16px; background: #fafafa; }',
        '.card { border-radius: 12px; padding: 24px; background: #f5f5f5; text-align: center; max-width: 320px; margin: 40px auto; }',
        '.title { font-size: 20px; font-weight: bold; margin-bottom: 8px; }',
        '.btn { margin-top: 16px; padding: 12px 32px; border: none; border-radius: 8px; background: #1976D2; color: white; font-size: 14px; cursor: pointer; }',
        '.btn:active { opacity: 0.8; }',
      ].join('\n'),
    },
    {
      path: 'app.js',
      content: [
        'let count = 0;',
        '',
        'async function handleClick() {',
        '  count++;',
        "  document.getElementById('counter').textContent = '点击次数: ' + count;",
        '',
        '  if (window.__amiba__) {',
        "    await __amiba__.showToast('点击了 ' + count + ' 次', 'success');",
        '  }',
        '}',
      ].join('\n'),
    },
  ],
}
