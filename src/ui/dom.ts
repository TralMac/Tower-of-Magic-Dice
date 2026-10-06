// 极简 DOM 工具：创建元素、弹窗。文字类界面都用 DOM 做（platform.md 第 2 节）。

type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, unknown>> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'style') el.setAttribute('style', String(v));
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k in el) (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export interface ModalAction {
  label: string;
  onClick?: () => void;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  /** 点击后不自动关闭弹窗 */
  keepOpen?: boolean;
}

export interface ModalOptions {
  title: string;
  body?: Child | Child[];
  actions?: ModalAction[];
  /** 点击背景是否关闭 */
  dismissable?: boolean;
  onClose?: () => void;
}

let openCount = 0;

export function isModalOpen(): boolean {
  return openCount > 0;
}

/** 打开一个底部弹出的面板；返回关闭函数 */
export function openModal(opts: ModalOptions): () => void {
  const root = document.getElementById('modal-root')!;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    openCount--;
    backdrop.remove();
    opts.onClose?.();
  };
  const body = Array.isArray(opts.body) ? opts.body : [opts.body];
  const actions = (opts.actions ?? []).map((a) =>
    h(
      'button',
      {
        class: a.primary ? 'primary' : a.danger ? 'danger' : '',
        disabled: a.disabled,
        onclick: () => {
          if (!a.keepOpen) close();
          a.onClick?.();
        },
      },
      a.label,
    ),
  );
  const modal = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, h('h2', {}, opts.title), ...body, actions.length ? h('div', { class: 'actions' }, ...actions) : null);
  const backdrop = h('div', {
    class: 'modal-backdrop',
    onclick: (e: Event) => {
      if (e.target === backdrop && opts.dismissable !== false) close();
    },
  });
  backdrop.append(modal);
  root.append(backdrop);
  openCount++;
  (actions.find((b) => !b.disabled) ?? modal).focus?.();
  return close;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
