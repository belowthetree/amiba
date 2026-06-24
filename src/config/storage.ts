// ============================================================
// 变形虫 (Amiba) — 存储层 (OPFS 系统配置目录)
// ============================================================

const APP_ROOT = 'amiba'
let opfsRoot: FileSystemDirectoryHandle | null = null

async function root(): Promise<FileSystemDirectoryHandle> {
  if (opfsRoot) return opfsRoot
  const r = await navigator.storage.getDirectory()
  opfsRoot = await r.getDirectoryHandle(APP_ROOT, { create: true })
  return opfsRoot
}

export async function storageGet(key: string): Promise<string | null> {
  try {
    const fileHandle = await (await root()).getFileHandle(key, { create: false })
    return await (await fileHandle.getFile()).text()
  } catch {
    return null
  }
}

export async function storageSet(key: string, value: string): Promise<void> {
  const fileHandle = await (await root()).getFileHandle(key, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(value)
  await writable.close()
}

export async function storageRemove(key: string): Promise<void> {
  try { await (await root()).removeEntry(key) } catch { /* ignore */ }
}

export async function storageKeys(): Promise<string[]> {
  const keys: string[] = []
  try { for await (const [name] of (await root() as any).entries()) keys.push(name) } catch {}
  return keys
}

export async function storageClear(): Promise<void> {
  try { for await (const [name] of (await root() as any).entries()) await (await root()).removeEntry(name) } catch {}
}

export async function storageGetJSON<T>(key: string): Promise<T | null> {
  const raw = await storageGet(key)
  if (!raw) return null
  try { return JSON.parse(raw) as T } catch { return null }
}

export async function storageSetJSON(key: string, value: any): Promise<void> {
  await storageSet(key, JSON.stringify(value))
}
