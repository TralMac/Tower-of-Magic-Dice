// 存档：IndexedDB（不可用时退回 localStorage）+ 存档码导出 / 导入（platform.md 第 2 节）。
// 存档里带着随机数状态：读档后同样的操作会得到同样的骰子（Q9）。

import { SAVE_VERSION, type GameState } from './core/tower';

export type Slot = 'quick' | 'auto' | 'resume';

const DB_NAME = 'tower-of-magic-dice';
const STORE = 'saves';
const LS_PREFIX = 'tomd.save.';

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

let dbPromise: Promise<IDBDatabase | null> | null = null;
const db = () => (dbPromise ??= openDb());

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return db().then(
    (d) =>
      new Promise<T | undefined>((resolve) => {
        if (!d) return resolve(undefined);
        try {
          const req = fn(d.transaction(STORE, mode).objectStore(STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      }),
  );
}

function valid(s: unknown): s is GameState {
  const g = s as GameState;
  return !!g && g.v === SAVE_VERSION && Array.isArray(g.grids) && !!g.hero && typeof g.seed === 'number';
}

export async function writeSave(slot: Slot, state: GameState): Promise<void> {
  const ok = await db();
  if (ok) await tx('readwrite', (s) => s.put(state, slot));
  else {
    try {
      localStorage.setItem(LS_PREFIX + slot, JSON.stringify(state));
    } catch {
      // 存储不可用：本次游玩无法存档
    }
  }
}

export async function readSave(slot: Slot): Promise<GameState | null> {
  const ok = await db();
  let data: unknown;
  if (ok) data = await tx('readonly', (s) => s.get(slot));
  else {
    try {
      const raw = localStorage.getItem(LS_PREFIX + slot);
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }
  }
  return valid(data) ? data : null;
}

export async function deleteSave(slot: Slot): Promise<void> {
  const ok = await db();
  if (ok) await tx('readwrite', (s) => s.delete(slot));
  else {
    try {
      localStorage.removeItem(LS_PREFIX + slot);
    } catch {
      // 忽略
    }
  }
}

/** 存档码：JSON → UTF-8 → base64，带前缀便于识别 */
export function exportCode(state: GameState): string {
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return 'TOMD1:' + btoa(bin);
}

export function importCode(code: string): GameState | null {
  try {
    const body = code.trim().replace(/^TOMD1:/, '');
    const bin = atob(body);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const data = JSON.parse(new TextDecoder().decode(bytes));
    return valid(data) ? data : null;
  } catch {
    return null;
  }
}
