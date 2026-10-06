// 自动游玩机器人：用规则核心把 3 层跑一遍，统计通关率与资源曲线，用来检查关卡的 HP / 精力 / 结晶账本。
// 用法：npm run autoplay -- [局数，默认 200]
//
// 机器人的打法（一个「中等水平」的玩家）：
//   - 每次选最近的目标：道具、能开的门、胜率 ≥ 95% 的怪、需要时去营火、买得起就去祭坛；
//   - 战斗中护甲磨损过半后卸甲；
//   - 没事可做就上楼；首领挡路就打首领。

import { predict, skillPolicy } from '../src/core/combat';
import { MONSTER_TILES } from '../src/core/data/floors';
import { MONSTERS } from '../src/core/data/monsters';
import { Game, monsterSpec, POTION, type AltarOption, type Pos } from '../src/core/tower';

const RUNS = Number(process.argv[2]) || 200;

interface Result {
  won: boolean;
  death: string;
  floor: number;
  hp: number;
  stamina: number;
  crystals: number;
  faints: number;
  steps: number;
  rests: number;
  altars: number;
  bossWin?: number;
}

function play(seed: number): Result {
  const g = Game.create(seed);
  let rests = 0;
  let death = '';
  let bossWin: number | undefined;
  let guard = 0;
  const altarOrder: AltarOption[] = ['atk', 'def', 'hp', 'atk', 'def', 'hp'];

  const winRate = (id: string) => predict(g.heroSpec(), monsterSpec(MONSTERS[id]), Math.max(0, g.hero.stamina - 3), 300, 'broken').winRate;

  while (g.state.status === 'playing' && guard++ < 2000) {
    const h = g.hero;
    const targets: Array<{ pos: Pos; kind: string }> = [];
    let bossPos: Pos | null = null;
    let upPos: Pos | null = null;
    for (let y = 0; y < g.height; y++) {
      for (let x = 0; x < g.width; x++) {
        const ch = g.tile({ x, y });
        const p = { x, y };
        const mid = MONSTER_TILES[ch];
        if (mid) {
          if (MONSTERS[mid].boss) bossPos = p;
          else targets.push({ pos: p, kind: 'monster' });
        } else if ('yuadw'.includes(ch)) targets.push({ pos: p, kind: 'pickup' });
        else if ((ch === 'h' || ch === 'H') && h.maxHp - h.hp >= POTION[ch] * 0.7) targets.push({ pos: p, kind: 'pickup' });
        else if (ch === 'Y' && h.keys.yellow > 0) targets.push({ pos: p, kind: 'door' });
        else if (ch === 'U' && h.keys.blue > 0) targets.push({ pos: p, kind: 'door' });
        else if (ch === 'c' && g.campfireUses(p) > 0 && (h.hp < h.maxHp * 0.65 || h.stamina < 45)) targets.push({ pos: p, kind: 'campfire' });
        else if (ch === 'A' && h.crystals >= g.altarPrice() && g.hero.altarCount < altarOrder.length) targets.push({ pos: p, kind: 'altar' });
        else if (ch === 'e') targets.push({ pos: p, kind: 'event' });
        else if (ch === 'x' && h.stamina < 30 && h.crystals >= 10) targets.push({ pos: p, kind: 'exchanger' });
        else if (ch === '>') upPos = p;
      }
    }
    // 只打胜率够高的怪
    const viable = targets
      .map((t) => ({ ...t, path: g.findPath(t.pos) }))
      .filter((t) => t.path && (t.kind !== 'monster' || winRate(MONSTER_TILES[g.tile(t.pos)]) >= 0.95))
      .sort((a, b) => a.path!.length - b.path!.length);

    let goal = viable[0] ?? null;
    // 没有稳赢的目标：先去营火补状态，再挑胜率最高的怪打
    if (!goal) {
      const fights = targets
        .filter((t) => t.kind === 'monster')
        .map((t) => ({ ...t, path: g.findPath(t.pos), win: winRate(MONSTER_TILES[g.tile(t.pos)]) }))
        .filter((t) => t.path && t.win >= 0.6)
        .sort((a, b) => b.win - a.win);
      if (fights.length) goal = fights[0];
    }
    // 还是没有：血瓶挡路时也只能喝掉
    if (!goal) {
      const potions: Array<{ pos: Pos; kind: string; path: Pos[] | null }> = [];
      for (let y = 0; y < g.height; y++)
        for (let x = 0; x < g.width; x++) if ('hH'.includes(g.tile({ x, y }))) potions.push({ pos: { x, y }, kind: 'pickup', path: g.findPath({ x, y }) });
      goal = potions.filter((p) => p.path).sort((a, b) => a.path!.length - b.path!.length)[0] ?? null;
    }
    if (!goal && upPos) {
      const path = g.findPath(upPos);
      if (path) goal = { pos: upPos, kind: 'stairs', path };
    }
    if (!goal && bossPos) {
      // 首领前先尽量在营火补满
      const path = g.findPath(bossPos);
      if (path) goal = { pos: bossPos, kind: 'boss', path };
    }
    if (!goal) {
      if (process.env.DEBUG_STUCK) console.log('stuck', seed, 'floor', g.state.floor + 1, 'pos', g.state.pos, JSON.stringify(g.hero.keys), 'hp', g.hero.hp, 'sta', g.hero.stamina, 'cry', g.hero.crystals, '\n' + g.state.grids[g.state.floor].join('\n'));
      death = 'stuck';
      break;
    }

    for (const step of goal.path!) {
      const outs = g.stepTo(step);
      let stop = false;
      for (const o of outs) {
        if (o.kind === 'monster') {
          if (o.monster.boss) bossWin = winRate(o.monster.id);
          const b = g.startBattle(o.monster, { autoSkill: skillPolicy('broken') });
          b.runToEnd();
          g.finishBattle(b, o.at);
          if ((g.state.status as string) === 'dead') death = `battle:${o.monster.id}`;
          stop = true;
        } else if (o.kind === 'object') {
          if (o.obj === 'campfire') {
            while (g.campfireUses(o.at) > 0 && (g.hero.hp < g.hero.maxHp * 0.9 || g.hero.stamina < g.hero.maxStamina - 30)) {
              g.rest(o.at);
              rests++;
            }
          }
          if (o.obj === 'altar') while (g.altar(altarOrder[g.hero.altarCount] ?? 'hp'));
          if (o.obj === 'event') g.resolveEvent(o.at, 'remember');
          if (o.obj === 'exchanger') while (g.hero.stamina < 60 && g.exchange('spring'));
          stop = true;
        } else if (o.kind === 'faint' && o.result.outcome === 'death') {
          death = 'faint';
          stop = true;
        } else if (o.kind !== 'moved') stop = true;
      }
      if (stop || g.state.status !== 'playing') break;
    }
  }

  return {
    won: g.state.status === 'won',
    death: g.state.status === 'won' ? '' : death || g.state.status,
    floor: g.state.floor + 1,
    hp: g.hero.hp,
    stamina: g.hero.stamina,
    crystals: g.hero.crystals,
    faints: g.state.stats.faints,
    steps: g.state.stats.steps,
    rests,
    altars: g.hero.altarCount,
    bossWin,
  };
}

const results = Array.from({ length: RUNS }, (_, i) => play(i + 1));
const avg = (f: (r: Result) => number, rs = results) => (rs.reduce((s, r) => s + f(r), 0) / Math.max(1, rs.length)).toFixed(1);
const won = results.filter((r) => r.won);
const deaths = new Map<string, number>();
for (const r of results) if (!r.won) deaths.set(r.death, (deaths.get(r.death) ?? 0) + 1);

console.log(`## 自动游玩 · ${RUNS} 局\n`);
console.log(`- 通关率：${((won.length / RUNS) * 100).toFixed(1)}%`);
console.log(`- 失败原因：${[...deaths].map(([k, v]) => `${k} ×${v}`).join('、') || '无'}`);
console.log(`- 平均步数 ${avg((r) => r.steps)}，平均昏迷 ${avg((r) => r.faints)} 次，平均休息 ${avg((r) => r.rests)} 次，祭坛 ${avg((r) => r.altars)} 次`);
console.log(`- 首领战前预测胜率（机器人视角）：${avg((r) => (r.bossWin ?? 0) * 100, results.filter((r) => r.bossWin !== undefined))}%`);
console.log(`- 通关时剩余：HP ${avg((r) => r.hp, won)}，精力 ${avg((r) => r.stamina, won)}，结晶 ${avg((r) => r.crystals, won)}`);
