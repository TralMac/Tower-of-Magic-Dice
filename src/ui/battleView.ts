// 战斗界面（DOM）：ATB 行动顺序条、双方状态、投骰演出、常驻技能按钮（platform.md 3.4）。
// 规则全部在 core/combat.ts，这里只负责按顺序播放事件。

import { UNARMOR_COST, type Battle, type BattleEvent, type Unit } from '../core/combat';
import { showPool, type Pool } from '../core/dice';
import type { MonsterDef } from '../core/data/monsters';
import { t, td } from '../i18n';
import { h, sleep } from './dom';

export type BattleOutcome = 'win' | 'lose' | 'retreat';

const SPEEDS = [1, 2, 4];
const pref = {
  get speed(): number {
    try {
      return Number(localStorage.getItem('tomd.speed')) || 1;
    } catch {
      return 1;
    }
  },
  set speed(v: number) {
    try {
      localStorage.setItem('tomd.speed', String(v));
    } catch {
      // 忽略
    }
  },
  get pause(): boolean {
    try {
      return localStorage.getItem('tomd.pause') === '1';
    } catch {
      return false;
    }
  },
  set pause(v: boolean) {
    try {
      localStorage.setItem('tomd.pause', v ? '1' : '0');
    } catch {
      // 忽略
    }
  },
};

const BASE_DELAY: Record<BattleEvent['t'], number> = {
  turn: 260,
  skill: 900,
  attack: 650,
  dodge: 450,
  defend: 650,
  drain: 450,
  group: 550,
  end: 500,
};

export function runBattle(battle: Battle, monster: MonsterDef, reduceMotion: boolean): Promise<BattleOutcome> {
  const root = document.getElementById('battle')!;
  root.hidden = false;
  const enemyName = td(`monster.${monster.id}.name`);
  const who = (side: 'hero' | 'enemy') => (side === 'hero' ? t('battle.you') : enemyName);

  let speed = pref.speed;
  let pauseOnTurn = pref.pause;
  let retreating = false;
  let resume: (() => void) | null = null;
  let stageDice: HTMLElement[] = [];
  let stageLine = '';
  const log: string[] = [];
  let flash: 'hero' | 'enemy' | null = null;

  const dieChip = (f: number) => h('span', { class: 'die' }, `d${f}`);
  const pool = (label: string, p: Pool) => h('span', { class: 'pool' }, label, ...(p.length ? p.map(dieChip) : ['—']));
  const pct = (v: number, max: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;

  const unitCard = (u: Unit, name: string) => {
    const tags: string[] = [];
    if (u.baseGroup > 0) tags.push(t('manual.group', { n: u.group }));
    if (u.side === 'hero') tags.push(`⚡ ${battle.stamina}`);
    return h(
      'section',
      { class: `unit ${u.side}${flash === u.side ? ' flash-hit' : ''}` },
      h(
        'div',
        { class: 'top' },
        h('span', { class: 'name' }, name),
        h('span', { class: 'tags' }, [`HP ${u.hp}/${u.maxHp}`, ...tags].join(' · ')),
      ),
      h('div', { class: 'bar hp' }, h('span', { style: `width:${pct(u.hp, u.maxHp)}` })),
      h('div', { class: 'dice-row' }, pool('⚔', u.atk), pool('🛡', u.armor), pool('💨', u.dodge)),
      h('div', { class: 'bar gauge' }, h('span', { style: `width:${pct(Math.max(0, u.gauge), 100)}` })),
    );
  };

  const skillButton = () => {
    const used = battle.skillUsed;
    const queued = battle.skillQueued;
    const state = used ? t('battle.skill.used') : queued ? t('battle.skill.ready') : t('battle.skill.cost', { n: UNARMOR_COST });
    return h(
      'button',
      {
        class: `skill-btn${queued ? ' ready' : ''}`,
        disabled: used || (!queued && !battle.canQueueSkill()),
        onclick: () => {
          if (battle.queueSkill()) render();
        },
      },
      t('battle.skill.btn'),
      h('small', {}, state),
    );
  };

  const render = () => {
    const order = battle.over ? [] : battle.previewOrder(8);
    root.replaceChildren(
      h(
        'div',
        { class: 'battle' },
        h(
          'div',
          { class: 'order' },
          t('battle.order'),
          ...order.map((s) => h('span', { class: `chip ${s}` }, s === 'hero' ? t('battle.you') : td(`monster.${monster.id}.short`))),
        ),
        unitCard(battle.enemy, enemyName),
        h('div', { class: 'stage' }, h('div', { class: 'dice-row' }, ...stageDice), h('div', { class: 'line' }, stageLine)),
        unitCard(battle.hero, t('hero.title').split(' · ')[0]),
        h('div', { class: 'log' }, ...log.slice(-3).map((l) => h('div', {}, l))),
        h(
          'div',
          { class: 'battle-controls' },
          monster.boss
            ? h('span', { class: 'muted' }, '')
            : h(
                'button',
                {
                  class: 'danger',
                  disabled: battle.over,
                  onclick: () => {
                    retreating = true;
                    resume?.();
                  },
                },
                t('btn.retreat'),
              ),
          h(
            'div',
            { class: 'speed' },
            ...SPEEDS.map((n) =>
              h(
                'button',
                {
                  class: n === speed ? 'on' : '',
                  onclick: () => {
                    speed = n;
                    pref.speed = n;
                    render();
                  },
                },
                t('battle.speed', { n }),
              ),
            ),
          ),
          battle.hero.spec.unarmor ? skillButton() : h('span', {}),
        ),
        h(
          'label',
          { class: 'toggle' },
          h('input', {
            type: 'checkbox',
            checked: pauseOnTurn,
            onchange: (e: Event) => {
              pauseOnTurn = (e.target as HTMLInputElement).checked;
              pref.pause = pauseOnTurn;
            },
          }),
          t('battle.pause'),
        ),
        resume
          ? h(
              'button',
              {
                class: 'primary',
                onclick: () => resume?.(),
              },
              t('battle.resume'),
            )
          : null,
      ),
    );
  };

  const faces = (vals: number[], extra?: number | null) => {
    const els = vals.map((v) => h('span', { class: 'die face roll' }, String(v)));
    if (extra) els.push(h('span', { class: 'die face echo roll' }, String(extra)));
    return els;
  };

  const show = (e: BattleEvent): 'skip' | void => {
    flash = null;
    switch (e.t) {
      case 'turn':
        stageDice = [];
        stageLine = e.side === 'hero' ? t('battle.turn.hero') : t('battle.turn.enemy', { name: enemyName });
        return;
      case 'skill':
        stageDice = [];
        stageLine = t('battle.skill', { armor: showPool(e.armor), atk: showPool(e.atk) });
        break;
      case 'attack':
        stageDice = faces(e.faces, e.echo);
        stageLine =
          t('battle.attack', {
            who: who(e.side),
            faces: e.faces.join('+'),
            echo: e.echo ? t('battle.echo', { v: e.echo }) : '',
            total: e.total,
          }) + (e.segs > 1 ? t('battle.attack.seg', { seg: e.seg + 1, segs: e.segs }) : '');
        break;
      case 'dodge':
        // 没有闪避骰的一方不演出闪避
        if (!e.faces.length && !e.success) return 'skip';
        if (e.faces.length) stageDice = faces(e.faces);
        stageLine = t(e.success ? 'battle.dodge.ok' : 'battle.dodge.fail', { who: who(e.side), total: e.total });
        break;
      case 'defend':
        stageDice = faces(e.faces);
        if (!e.success) flash = e.side;
        stageLine = t(e.success ? 'battle.defend.ok' : 'battle.defend.fail', {
          who: who(e.side),
          total: e.total,
          damage: e.damage,
          armor: showPool(e.armor),
        });
        break;
      case 'drain':
        stageLine = t('battle.drain', { n: e.amount });
        break;
      case 'group':
        stageLine = t('battle.group', { who: who(e.side), n: e.group });
        break;
      case 'end':
        stageDice = [];
        stageLine = e.winner === 'hero' ? '' : t('battle.lose');
        break;
    }
    if (stageLine) log.push(stageLine);
  };

  return (async () => {
    render();
    await sleep(300);
    while (!battle.over && !retreating) {
      if (pauseOnTurn && battle.previewOrder(1)[0] === 'hero') {
        await new Promise<void>((r) => {
          resume = () => {
            resume = null;
            r();
          };
          render();
        });
        render();
        if (retreating) break;
      }
      const events = battle.next();
      for (const e of events) {
        if (retreating) break;
        if (show(e) === 'skip') continue;
        render();
        const factor = reduceMotion ? 0.5 : 1;
        await sleep((BASE_DELAY[e.t] * factor) / speed);
      }
    }
    render();
    const outcome: BattleOutcome = battle.over ? (battle.winner === 'hero' ? 'win' : 'lose') : 'retreat';
    if (outcome === 'retreat') {
      stageDice = [];
      stageLine = t('battle.retreated');
      render();
      await sleep(500);
    }
    return outcome;
  })();
}

export function closeBattle(): void {
  const root = document.getElementById('battle')!;
  root.hidden = true;
  root.replaceChildren();
}
