import type { Game } from '../core/tower';
import { t } from '../i18n';
import { h } from './dom';

const bar = (value: number, max: number, color: string) =>
  h('span', { class: 'hud-bar' }, h('span', { style: `width:${Math.max(0, Math.min(100, (value / max) * 100))}%;background:${color}` }));

export function renderHud(el: HTMLElement, game: Game): void {
  const s = game.hero;
  el.replaceChildren(
    h('span', { class: 'hud-item', title: t('hud.hp') }, '❤ ', `${s.hp}/${s.maxHp}`, bar(s.hp, s.maxHp, 'var(--hp)')),
    h(
      'span',
      { class: 'hud-item', title: t('hud.stamina') },
      '⚡ ',
      `${s.stamina}/${s.maxStamina}`,
      bar(s.stamina, s.maxStamina, 'var(--stamina)'),
    ),
    h('span', { class: 'hud-item', title: t('hud.crystals') }, '💎 ', String(s.crystals)),
    h(
      'span',
      { class: 'hud-item' },
      h('span', { class: 'dot', style: 'background:var(--yellow)' }),
      ` ${t('hud.keys.yellow')} ${s.keys.yellow}　`,
      h('span', { class: 'dot', style: 'background:var(--blue)' }),
      ` ${t('hud.keys.blue')} ${s.keys.blue}`,
      s.firewood ? `　🪵 ${s.firewood}` : '',
    ),
    h('span', { class: 'hud-item hud-floor' }, t('hud.floor', { n: game.state.floor + 1 })),
  );
}

export function setStatus(text: string, warn = false): void {
  const el = document.getElementById('status-bar')!;
  el.textContent = text;
  el.classList.toggle('warn', warn);
}
