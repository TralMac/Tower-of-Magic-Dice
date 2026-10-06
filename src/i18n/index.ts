import { en } from './en';
import { zhCN, type MessageKey } from './zh-CN';

export type Lang = 'zh-CN' | 'en';
export type { MessageKey };

const tables: Record<Lang, Record<MessageKey, string>> = { 'zh-CN': zhCN, en };
const STORAGE_KEY = 'tomd.lang';

function detect(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'zh-CN' || saved === 'en') return saved;
  } catch {
    // 隐私模式等情况下 localStorage 不可用
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'zh-CN';
  return nav.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

let current: Lang = detect();

export function lang(): Lang {
  return current;
}

export function setLang(l: Lang): void {
  current = l;
  try {
    localStorage.setItem(STORAGE_KEY, l);
  } catch {
    // 忽略
  }
  document.documentElement.lang = l;
}

export function t(key: MessageKey, params: Record<string, string | number> = {}): string {
  const text = tables[current][key] ?? zhCN[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? `{${k}}`));
}

/** 动态 key（如 monster.<id>.name）；找不到时回退到 key 本身 */
export function td(key: string, params: Record<string, string | number> = {}): string {
  return key in zhCN ? t(key as MessageKey, params) : key;
}
