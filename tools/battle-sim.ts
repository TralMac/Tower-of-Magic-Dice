// 骰子魔塔 · 数值模拟器（蒙特卡洛），直接调用游戏的规则核心 src/core。
// 用法：npm run sim -- [每组对局次数，默认 20000]

import { predict, type SkillPolicy, type UnitSpec } from '../src/core/combat';
import { parsePool, showPool, upgrade } from '../src/core/dice';
import { CAMPFIRE_USES, FLOORS, MONSTER_TILES } from '../src/core/data/floors';
import { HEROES } from '../src/core/data/heroes';
import { MONSTERS } from '../src/core/data/monsters';
import { CAMPFIRE, monsterSpec, POTION } from '../src/core/tower';

const N = Number(process.argv[2]) || 20000;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

const w = HEROES.warrior;
const warrior = (over: Partial<UnitSpec> = {}): UnitSpec => ({
  id: 'warrior',
  atk: parsePool(w.atk),
  def: parsePool(w.def),
  dodge: parsePool(w.dodge),
  hp: w.maxHp,
  maxHp: w.maxHp,
  spd: w.spd,
  rolandsVoice: true,
  unarmor: true,
  ...over,
});

// ---------- 1. 战士对各怪物（1 级、满血） ----------
const variants: Array<[string, SkillPolicy]> = [
  ['不卸甲', 'never'],
  ['第一次行动就卸甲', 'first'],
  ['护甲磨损过半后卸甲', 'broken'],
];
console.log(`## 战士（1 级）对各怪物 · 每组 ${N} 场 · 胜率 / 平均掉血 / 90% 分位掉血\n`);
console.log(`| 怪物 | ${variants.map((v) => v[0]).join(' | ')} |`);
console.log(`|---|${variants.map(() => '---').join('|')}|`);
for (const m of Object.values(MONSTERS)) {
  const cells = variants.map(([, policy]) => {
    const p = predict(warrior(), monsterSpec(m), 100, N, policy);
    return `${pct(p.winRate)} / ${p.avgLoss.toFixed(1)} / ${p.p90Loss}`;
  });
  console.log(`| ${m.id}${m.group ? ` [群体${m.group}]` : ''} | ${cells.join(' | ')} |`);
}

// ---------- 2. 三层流程的资源账本 ----------
// 假设玩家打完每层的所有怪物，按层吃到宝石、在祭坛买升级；用「护甲磨损过半后卸甲」的打法。
interface Build {
  label: string;
  atk: number[];
  def: number[];
  maxHp: number;
}
const builds: Build[] = [];
let atk = parsePool(w.atk);
let def = parsePool(w.def);
let maxHp = w.maxHp;
// 第 1 层：基础属性
builds.push({ label: '第 1 层', atk, def, maxHp });
// 第 1 层攻击宝石
atk = upgrade(atk);
// 第 2 层开始：祭坛第 1 次（20 结晶）买攻击
atk = upgrade(atk);
builds.push({ label: '第 2 层', atk, def, maxHp });
// 第 2 层防御宝石
def = upgrade(def);
builds.push({ label: '第 3 层', atk, def, maxHp });
// 第 3 层攻防宝石 + 祭坛第 2 次（30 结晶）买 HP
atk = upgrade(atk);
def = upgrade(def);
maxHp += 10;
builds.push({ label: '首领战前', atk, def, maxHp });

console.log(`\n## 三层流程账本（打法：护甲磨损过半后卸甲）\n`);
let crystals = 0;
FLOORS.forEach((rows, f) => {
  const b = builds[f];
  const counts = new Map<string, number>();
  let heal = 0;
  let fires = 0;
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const id = MONSTER_TILES[ch];
      if (id && !MONSTERS[id].boss) counts.set(id, (counts.get(id) ?? 0) + 1);
      if (ch === 'h' || ch === 'H') heal += POTION[ch];
      if (ch === 'c') fires += CAMPFIRE_USES[`${f},${x},${y}`] ?? CAMPFIRE.uses;
    });
  });
  let loss = 0;
  let worstWin = 1;
  const parts: string[] = [];
  for (const [id, n] of counts) {
    const m = MONSTERS[id];
    const p = predict(warrior({ atk: b.atk, def: b.def, hp: b.maxHp, maxHp: b.maxHp }), monsterSpec(m), 100, N / 4, 'broken');
    loss += p.avgLoss * n;
    worstWin = Math.min(worstWin, p.winRate);
    crystals += m.crystals * n;
    parts.push(`${id}×${n}（${p.avgLoss.toFixed(1)}）`);
  }
  const fireHeal = fires * Math.ceil(b.maxHp * CAMPFIRE.hpRatio);
  console.log(`- **${b.label}** 攻 ${showPool(b.atk)} 防 ${showPool(b.def)} HP ${b.maxHp}`);
  console.log(`  - 怪物：${parts.join('、')}`);
  console.log(`  - 预计掉血 ${loss.toFixed(0)}，血瓶 +${heal}，营火最多 +${fireHeal}；最低单场胜率 ${pct(worstWin)}；累计结晶 ${crystals}`);
});

const boss = Object.values(MONSTERS).find((m) => m.boss)!;
const last = builds[builds.length - 1];
console.log(`\n## 首领 ${boss.id}（${last.label}：攻 ${showPool(last.atk)} 防 ${showPool(last.def)}）\n`);
console.log('| 战前 HP | 不卸甲 | 护甲磨损过半后卸甲 |');
console.log('|---|---|---|');
for (const hp of [last.maxHp, 45, 35]) {
  const cells = (['never', 'broken'] as SkillPolicy[]).map((policy) => {
    const p = predict(warrior({ atk: last.atk, def: last.def, hp, maxHp: last.maxHp }), monsterSpec(boss), 100, N, policy);
    return `${pct(p.winRate)} / 掉血 ${p.avgLoss.toFixed(1)}`;
  });
  console.log(`| ${hp} | ${cells.join(' | ')} |`);
}
