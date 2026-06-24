// ============================================================
// 变形虫 (Amiba) — 存储层
// 本地文件夹 > Capacitor > OPFS
// ============================================================

const APP_ROOT = 'amiba'

// --- Folder handle ---
let folderHandle: FileSystemDirectoryHandle | null = null
const FOLDER_KEY = 'amiba_storage_folder'

export async function setStorageFolder(handle: FileSystemDirectoryHandle) {
  folderHandle = handle
  // Verify by writing a test file
  try {
    const fh = await handle.getFileHandle('_amiba_test_', { create: true })
    const w = await fh.createWritable()
    await w.write('ok')
    await w.close()
    await handle.removeEntry('_amiba_test_')
    localStorage.setItem(FOLDER_KEY, '1')
    console.log('[Storage] 本地文件夹已激活，测试写入成功')
  } catch (e: any) {
    console.error('[Storage] 文件夹写入测试失败:', e)
    alert('该文件夹无写入权限: ' + e.message)
    folderHandle = null
  }
}

export async function initStorage() {
  // Native app: Capacitor handles it, nothing to do
  if ((window as any).Capacitor?.isNative?.()) {
    console.log('[Storage] 原生环境，使用 OS 配置目录')
    return
  }

  // Browser: try to restore previous folder permission
  if (localStorage.getItem(FOLDER_KEY) === '1') {
    try {
      folderHandle = await (window as any).showDirectoryPicker({
        mode: 'readwrite',
        id: 'amiba-storage',
        startIn: 'documents',
      })
      console.log('[Storage] 已恢复本地文件夹权限')
      return
    } catch {
      localStorage.removeItem(FOLDER_KEY)
    }
  }

  // First launch: ask user to pick a folder
  console.log('[Storage] 首次使用，弹出文件夹选择器...')
  try {
    folderHandle = await (window as any).showDirectoryPicker({
      mode: 'readwrite',
      id: 'amiba-storage',
      startIn: 'documents',
    })
    // Verify write permission
    const fh = folderHandle!; const testFh = await fh.getFileHandle('_amiba_test_', { create: true })
    const w = await testFh.createWritable(); await w.write('ok'); await w.close()
    await fh.removeEntry('_amiba_test_')
    localStorage.setItem(FOLDER_KEY, '1')
    console.log('[Storage] 本地文件夹已激活')
  } catch {
    console.log('[Storage] 用户跳过，使用 OPFS')
  }
}

export async function clearStorageFolder() {
  folderHandle = null
  localStorage.removeItem(FOLDER_KEY)
  console.log('[Storage] 已清除本地文件夹，切回默认存储')
}

export function hasStorageFolder(): boolean {
  return folderHandle !== null
}

// --- Folder backend ---
async function folderGet(key: string): Promise<string | null> {
  if (!folderHandle) return null
  try {
    const fh = await folderHandle.getFileHandle(key, { create: false })
    return await (await fh.getFile()).text()
  } catch { return null }
}

async function folderSet(key: string, value: string): Promise<void> {
  if (!folderHandle) throw new Error('No folder selected')
  const fh = await folderHandle.getFileHandle(key, { create: true })
  const w = await fh.createWritable()
  await w.write(value)
  await w.close()
}

async function folderRemove(key: string): Promise<void> {
  if (!folderHandle) return
  try { await folderHandle.removeEntry(key) } catch {}
}

async function folderKeys(): Promise<string[]> {
  if (!folderHandle) return []
  const keys: string[] = []
  try { for await (const [name] of (folderHandle as any).entries()) keys.push(name) } catch {}
  return keys
}

async function folderClear(): Promise<void> {
  if (!folderHandle) return
  try { for await (const [name] of (folderHandle as any).entries()) await folderHandle.removeEntry(name) } catch {}
}

// --- Capacitor backend ---
async function capacitorGet(key: string): Promise<string | null> {
  try {
    const { Filesystem } = await import('@capacitor/filesystem')
    const r = await Filesystem.readFile({ path: APP_ROOT + '/' + key, directory: 'DATA' as any, encoding: 'utf8' as any })
    return r.data as string
  } catch { return null }
}

async function capacitorSet(key: string, value: string): Promise<void> {
  const { Filesystem } = await import('@capacitor/filesystem')
  await Filesystem.writeFile({ path: APP_ROOT + '/' + key, data: value, directory: 'DATA' as any, encoding: 'utf8' as any, recursive: true })
}

async function capacitorRemove(key: string): Promise<void> {
  try { const { Filesystem } = await import('@capacitor/filesystem'); await Filesystem.deleteFile({ path: APP_ROOT + '/' + key, directory: 'DATA' as any }) } catch {}
}

async function capacitorKeys(): Promise<string[]> {
  try { const { Filesystem } = await import('@capacitor/filesystem'); const r = await Filesystem.readdir({ path: APP_ROOT, directory: 'DATA' as any }); return r.files.map((f: any) => f.name) } catch { return [] }
}

async function capacitorClear(): Promise<void> {
  try { const ks = await capacitorKeys(); for (const k of ks) await capacitorRemove(k) } catch {}
}

// --- OPFS backend ---
let opfsRoot: FileSystemDirectoryHandle | null = null
async function opfsDir(): Promise<FileSystemDirectoryHandle> {
  if (opfsRoot) return opfsRoot
  opfsRoot = await (await navigator.storage.getDirectory()).getDirectoryHandle(APP_ROOT, { create: true })
  return opfsRoot
}
async function opfsGet(key: string): Promise<string | null> {
  try { const f = await (await (await opfsDir()).getFileHandle(key, { create: false })).getFile(); return await f.text() } catch { return null }
}
async function opfsSet(key: string, value: string): Promise<void> {
  const fh = await (await opfsDir()).getFileHandle(key, { create: true }); const w = await fh.createWritable(); await w.write(value); await w.close()
}
async function opfsRemove(key: string): Promise<void> {
  try { await (await opfsDir()).removeEntry(key) } catch {}
}
async function opfsKeys(): Promise<string[]> {
  const keys: string[] = []; try { for await (const [name] of (await opfsDir() as any).entries()) keys.push(name) } catch {}; return keys
}
async function opfsClear(): Promise<void> {
  try { for await (const [name] of (await opfsDir() as any).entries()) await (await opfsDir()).removeEntry(name) } catch {}
}

// --- Active backend ---
type Backend = 'folder' | 'capacitor' | 'opfs'
function activeBackend(): Backend {
  if (folderHandle) return 'folder'
  if ((window as any).Capacitor?.isNative?.()) return 'capacitor'
  return 'opfs'
}
function logBackend() { console.log('[Storage] 后端:', activeBackend()) }

// --- Public API ---
export async function storageGet(key: string): Promise<string | null> {
  const be = activeBackend()
  const val = be === 'folder' ? await folderGet(key) : be === 'capacitor' ? await capacitorGet(key) : await opfsGet(key)
  console.log('[Storage] GET', key, val ? `(${(val.length / 1024).toFixed(1)}KB)` : '(null)', '←', be)
  return val
}
export async function storageSet(key: string, value: string): Promise<void> {
  const be = activeBackend()
  console.log('[Storage] SET', key, `(${(value.length / 1024).toFixed(1)}KB)`, '→', be)
  if (be === 'folder') return folderSet(key, value)
  if (be === 'capacitor') return capacitorSet(key, value)
  return opfsSet(key, value)
}
export async function storageRemove(key: string): Promise<void> {
  const be = activeBackend()
  console.log('[Storage] DEL', key, '→', be)
  if (be === 'folder') return folderRemove(key)
  if (be === 'capacitor') return capacitorRemove(key)
  return opfsRemove(key)
}
export async function storageKeys(): Promise<string[]> {
  const be = activeBackend()
  if (be === 'folder') return folderKeys()
  if (be === 'capacitor') return capacitorKeys()
  return opfsKeys()
}
export async function storageClear(): Promise<void> {
  const be = activeBackend()
  if (be === 'folder') return folderClear()
  if (be === 'capacitor') return capacitorClear()
  return opfsClear()
}
export async function storageGetJSON<T>(key: string): Promise<T | null> {
  const raw = await storageGet(key); if (!raw) return null; try { return JSON.parse(raw) as T } catch { return null }
}
export async function storageSetJSON(key: string, value: any): Promise<void> {
  await storageSet(key, JSON.stringify(value))
}
export async function getStorageBackend(): Promise<string> {
  const be = activeBackend()
  if (be === 'folder') return '本地文件夹'
  if (be === 'capacitor') return 'OS 配置目录'
  return 'OPFS (浏览器)'
}
