// 骰子魔塔 · 战斗数值模拟器（蒙特卡洛）
// 用法：node sim/battle-sim.mjs [每组对局次数，默认 20000]
// 只实现 GDD 中的基础规则：闪避 → 防御 → 伤害 → 护甲磨损、群体多段、特质平值修正、高打低。
// 技能与遗物不在这里模拟，用来给数值定一个「裸装基线」。

const N = Number(process.argv[2]) || 20000;

// ---------- 骰池 ----------
// 骰池用「每颗骰子的面数」数组表示，如 2d6 = [6, 6]，d6+d4 = [6, 4]。
// 护甲等级 = 所有防御骰面数之和。
const parse = (s) =>
  s.split('+').flatMap((part) => {
    const [n, f] = part.split('d').map(Number);
    return Array(n || 1).fill(f);
  });
const show = (pool) => {
  if (!pool.length) return '—';
  const counts = {};
  for (const f of pool) counts[f] = (counts[f] || 0) + 1;
  return Object.keys(counts)
    .map(Number)
    .sort((a, b) => b - a)
    .map((f) => `${counts[f]}d${f}`)
    .join('+');
};
const roll = (pool) => pool.reduce((s, f) => s + 1 + Math.floor(Math.random() * f), 0);

// 护甲磨损：每降 1 级，面数最小的骰子 -1 面；降到 d1 时碎裂移除。
function wear(pool, levels) {
  const p = [...pool];
  for (let i = 0; i < levels && p.length; i++) {
    p.sort((a, b) => b - a);
    p[p.length - 1] -= 1;
    if (p[p.length - 1] <= 1) p.pop();
  }
  return p;
}

// ---------- 单段攻击 ----------
function strike(att, def, log) {
  let a = roll(att.atk) + att.atkMod;
  if (att.tier > def.tier) a += 1; // 高打低
  a = Math.max(0, a);
  const dodge = def.dodge.length ? Math.max(0, roll(def.dodge) + def.dodgeMod) : 0;
  if (a <= dodge) {
    log.dodged++;
    return;
  }
  const d = Math.max(0, roll(def.armor) + def.defMod);
  if (a > d) {
    def.hp -= a - d;
    def.armor = wear(def.armor, 2);
    log.broken++;
  } else {
    def.armor = wear(def.armor, 1);
    log.blocked++;
  }
}

function battle(heroTpl, monTpl) {
  const hero = { ...heroTpl, armor: parse(heroTpl.def), atk: parse(heroTpl.atkDice), dodge: heroTpl.dodgeDice ? parse(heroTpl.dodgeDice) : [] };
  const mon = { ...monTpl, armor: parse(monTpl.def), atk: parse(monTpl.atkDice), dodge: monTpl.dodgeDice ? parse(monTpl.dodgeDice) : [] };
  const log = { dodged: 0, blocked: 0, broken: 0 };
  // 先手：速度高者先；同速玩家先。
  const order = hero.spd >= mon.spd ? [hero, mon] : [mon, hero];
  let rounds = 0;
  while (hero.hp > 0 && mon.hp > 0 && rounds < 200) {
    rounds++;
    for (const u of order) {
      const target = u === hero ? mon : hero;
      const hits = 1 + (u.group || 0);
      for (let h = 0; h < hits && target.hp > 0; h++) strike(u, target, log);
      if (target.hp <= 0) break;
    }
  }
  return { win: hero.hp > 0, hpLost: heroTpl.hp - Math.max(0, hero.hp), rounds };
}

// ---------- 数据 ----------
const base = { atkMod: 0, defMod: 0, dodgeMod: 0, tier: 1, group: 0 };
const heroes = [
  { ...base, name: '铁卫「三棱」', atkDice: '3d4', def: '2d6', dodgeDice: '1d2', hp: 50, spd: 2 },
  { ...base, name: '剑士「双子」', atkDice: '2d6', def: '1d6+1d4', dodgeDice: '1d4', hp: 50, spd: 3 },
  { ...base, name: '赌徒「孤注」', atkDice: '1d12', def: '1d6', dodgeDice: '1d6', hp: 45, spd: 4 },
  { ...base, name: '咒术师「蚀骨」', atkDice: '1d8+1d4', def: '1d4+1d4', dodgeDice: '1d4', hp: 50, spd: 3 },
];
const monsters = [
  { ...base, name: '绿史莱姆', atkDice: '1d4', def: '1d4', hp: 10, spd: 1 },
  { ...base, name: '蝙蝠群 [群体1]', atkDice: '1d4', def: '1d2', dodgeDice: '1d6', hp: 8, spd: 5, group: 1 },
  { ...base, name: '骷髅兵', atkDice: '2d4', def: '2d6', dodgeDice: '1d2', hp: 16, spd: 2 },
  { ...base, name: '哥布林群 [群体2]', atkDice: '1d6', def: '1d4', dodgeDice: '1d4', hp: 18, spd: 3, group: 2 },
  { ...base, name: '兽人战士', atkDice: '2d6', def: '2d6', dodgeDice: '1d2', hp: 28, spd: 2, tier: 2 },
  { ...base, name: '首领·骨龙 [群体1]', atkDice: '2d8', def: '2d8', dodgeDice: '1d4', hp: 60, spd: 3, tier: 3, group: 1 },
];

// ---------- 护甲阶梯演示 ----------
let p = parse('2d6');
const ladder = [show(p)];
while (p.length) {
  p = wear(p, 1);
  ladder.push(show(p));
}
console.log('护甲阶梯（2d6 每次 -1 级）：', ladder.join(' → '));
console.log('');

// ---------- 对局统计 ----------
const pct = (x) => `${(x * 100).toFixed(1)}%`;
for (const h of heroes) {
  console.log(`## ${h.name}  攻${h.atkDice} 防${h.def} 闪${h.dodgeDice} HP${h.hp} 速${h.spd}`);
  console.log('| 怪物 | 胜率 | 平均掉血 | 90% 分位掉血 | 平均回合 |');
  console.log('|---|---|---|---|---|');
  for (const m of monsters) {
    const res = Array.from({ length: N }, () => battle(h, m));
    const wins = res.filter((r) => r.win).length / N;
    const losses = res.map((r) => r.hpLost).sort((a, b) => a - b);
    const avgLoss = losses.reduce((s, x) => s + x, 0) / N;
    const p90 = losses[Math.floor(N * 0.9)];
    const avgRounds = res.reduce((s, r) => s + r.rounds, 0) / N;
    console.log(`| ${m.name} | ${pct(wins)} | ${avgLoss.toFixed(1)} | ${p90} | ${avgRounds.toFixed(1)} |`);
  }
  console.log('');
}
