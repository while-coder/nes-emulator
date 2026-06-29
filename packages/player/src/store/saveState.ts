/**
 * 存档点持久化:把引擎状态快照存入 IndexedDB,按 (romKey, slot) 索引。
 *
 * 与 ROM 缓存(romLibrary)分库,互不影响。slot 为任意字符串,当前 UI 仅用
 * 'quick' 单槽快速存读,但存储层支持多槽位,便于以后扩展存档列表。
 */
import type { SaveState } from '../emulator/runner'

export type SaveStateRecord = {
  /** 主键:`${romKey}:${slot}`。 */
  key: string
  romKey: string
  slot: string
  /** 存档时的 ROM 显示名,供存档列表展示。 */
  name: string
  state: SaveState
  savedAt: number
}

const DB_NAME = 'nes-save-states'
const DB_VERSION = 1
const STORE_NAME = 'saves'

let dbPromise: Promise<IDBDatabase> | null = null

function recordKey(romKey: string, slot: string): string {
  return `${romKey}:${slot}`
}

export async function putSaveState(
  romKey: string,
  slot: string,
  name: string,
  state: SaveState,
): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  const done = txDone(tx)
  const record: SaveStateRecord = {
    key: recordKey(romKey, slot),
    romKey,
    slot,
    name,
    state,
    savedAt: Date.now(),
  }
  await requestToPromise(tx.objectStore(STORE_NAME).put(record))
  await done
}

export async function getSaveState(romKey: string, slot: string): Promise<SaveStateRecord | null> {
  const db = await openDb()
  const tx = db.transaction(STORE_NAME, 'readonly')
  const done = txDone(tx)
  const record = await requestToPromise<SaveStateRecord | undefined>(
    tx.objectStore(STORE_NAME).get(recordKey(romKey, slot)),
  )
  await done
  return record ?? null
}

/** 列出某卡带的全部存档点(按存档时间倒序)。 */
export async function listSaveStates(romKey: string): Promise<SaveStateRecord[]> {
  const db = await openDb()
  const tx = db.transaction(STORE_NAME, 'readonly')
  const done = txDone(tx)
  const all = await requestToPromise<SaveStateRecord[]>(tx.objectStore(STORE_NAME).getAll())
  await done
  return all.filter((r) => r.romKey === romKey).sort((a, b) => b.savedAt - a.savedAt)
}

export async function deleteSaveState(romKey: string, slot: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  const done = txDone(tx)
  await requestToPromise(tx.objectStore(STORE_NAME).delete(recordKey(romKey, slot)))
  await done
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('无法打开存档库'))
  })
  return dbPromise
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 操作失败'))
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 事务已中止'))
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 事务失败'))
  })
}
