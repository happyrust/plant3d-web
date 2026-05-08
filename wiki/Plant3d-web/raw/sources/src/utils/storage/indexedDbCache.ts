/**
 * IndexedDB JSON cache (lightweight, no deps).
 *
 * 约定：
 * - DB: plant3d_cache (version=1)
 * - Stores:
 *   - meta_info: key = 'db_meta_info'
 *   - instances_shared: key = 'trans' | 'aabb'
 *
 * 失败策略：任何 I/O/解析错误均直接抛错（不做 silent fallback）。
 */

export type Plant3dCacheStore = 'meta_info' | 'instances_shared'

const DB_NAME = 'plant3d_cache';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function requireIndexedDb(): IDBFactory {
  const anyGlobal = globalThis as any;
  const idb = anyGlobal?.indexedDB as IDBFactory | undefined;
  if (!idb) {
    throw new Error('[indexeddb] 当前环境不支持 IndexedDB');
  }
  return idb;
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const idb = requireIndexedDb();

  dbPromise = new Promise((resolve, reject) => {
    const req = idb.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('meta_info')) {
        db.createObjectStore('meta_info');
      }
      if (!db.objectStoreNames.contains('instances_shared')) {
        db.createObjectStore('instances_shared');
      }
    };

    req.onsuccess = () => {
      const db = req.result;
      // 防止多 tab 升级时使用旧连接
      db.onversionchange = () => {
        try {
          db.close();
        } catch {
          // ignore
        }
      };
      resolve(db);
    };

    req.onblocked = () => {
      reject(new Error('[indexeddb] 打开数据库被阻塞（可能存在其它 tab 未关闭）'));
    };

    req.onerror = () => {
      reject(req.error ?? new Error('[indexeddb] 打开数据库失败'));
    };
  });

  return dbPromise;
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('[indexeddb] request failed'));
  });
}

async function withStore<T>(
  store: Plant3dCacheStore,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  const tx = db.transaction(store, mode);
  const s = tx.objectStore(store);
  const result = await requestToPromise(fn(s));

  // 等待事务真正落盘（避免上层以为写入成功但 tx abort）
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('[indexeddb] transaction aborted'));
    tx.onerror = () => reject(tx.error ?? new Error('[indexeddb] transaction error'));
  });

  return result;
}

export async function getJson<T = unknown>(store: Plant3dCacheStore, key: string): Promise<T | null> {
  const v = await withStore(store, 'readonly', (s) => s.get(key));
  return (v ?? null) as T | null;
}

export async function setJson<T = unknown>(store: Plant3dCacheStore, key: string, value: T): Promise<void> {
  await withStore(store, 'readwrite', (s) => s.put(value as any, key));
}

export async function remove(store: Plant3dCacheStore, key: string): Promise<void> {
  await withStore(store, 'readwrite', (s) => s.delete(key));
}

