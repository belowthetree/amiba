// CDP 单次求值工具：node harmony/scripts/cdp-eval.mjs <ws-url> <expression-file>
// 在真机 ArkWeb 页面上下文里执行 JS（awaitPromise + returnByValue），用于桥层/页面调试。
// 取 ws-url 的步骤（hdc 必须在仓库根目录执行）：
//   1. hdc shell "ps -ef | grep com.amiba.app | grep -v grep"            # 取主进程 PID
//   2. hdc fport tcp:9223 localabstract:webview_devtools_remote_<PID>
//   3. curl -s http://127.0.0.1:9223/json                                # 找 url 为 amiba://local/ 的 target id
//   4. ws-url = ws://127.0.0.1:9223/devtools/page/<id>
// expression 建议用 Promise.race 包几秒超时，以便检测挂起而不是干等。
import { readFileSync } from 'node:fs'

const [wsUrl, exprFile] = process.argv.slice(2)
const expr = readFileSync(exprFile, 'utf8')

const ws = new WebSocket(wsUrl)
let id = 0

function send(method, params) {
  return new Promise((resolve, reject) => {
    const msgId = ++id
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data)
      if (m.id === msgId) {
        ws.removeEventListener('message', onMsg)
        if (m.error) reject(new Error(JSON.stringify(m.error)))
        else resolve(m.result)
      }
    }
    ws.addEventListener('message', onMsg)
    ws.send(JSON.stringify({ id: msgId, method, params }))
  })
}

ws.onopen = async () => {
  try {
    await send('Runtime.enable', {})
    const res = await send('Runtime.evaluate', {
      expression: expr,
      awaitPromise: true,
      returnByValue: true,
      timeout: 15000,
    })
    console.log(JSON.stringify(res, null, 2))
  } catch (e) {
    console.error('EVAL_FAIL:', e.message)
  } finally {
    ws.close()
    process.exit(0)
  }
}
ws.onerror = (e) => { console.error('WS_ERR', e.message ?? e); process.exit(1) }
setTimeout(() => { console.error('SCRIPT_TIMEOUT'); process.exit(1) }, 20000)
