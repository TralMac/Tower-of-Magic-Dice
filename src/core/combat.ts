// 战斗规则核心（GDD 第 3～5 节）：ATB 行动条 → 攻击投骰 → 闪避 → 防御 → 伤害 → 护甲磨损。
// 纯逻辑，不依赖渲染；游戏、概率手册、数值模拟器、单元测试共用这一份。

import { halve, poolLevel, rollFaces, sum, wear, type Pool } from './dice';
import { mathRng, type Rng } from './rng';

/** 行动条满值 */
export const GAUGE = 100;
/** 战士主动「卸甲」的精力消耗 */
export const UNARMOR_COST = 10;

export type Side = 'hero' | 'enemy';

/** 参战单位的配置（战斗开始时的状态） */
export interface UnitSpec {
  id: string;
  atk: Pool;
  def: Pool;
  dodge: Pool;
  hp: number;
  maxHp: number;
  spd: number;
  /** 群体层数：每次攻击 1 + group 段 */
  group?: number;
  atkMod?: number;
  defMod?: number;
  dodgeMod?: number;
  /** 战士被动「罗兰之声」 */
  rolandsVoice?: boolean;
  /** 战士主动「卸甲」 */
  unarmor?: boolean;
  /** 怪物技能：打穿玩家防御时，玩家精力 −n */
  drainStamina?: number;
  /** 首领：不能撤退 */
  boss?: boolean;
}

export interface Unit {
  side: Side;
  spec: UnitSpec;
  atk: Pool;
  armor: Pool;
  dodge: Pool;
  hp: number;
  maxHp: number;
  spd: number;
  gauge: number;
  baseGroup: number;
  group: number;
  unarmored: boolean;
  actions: number;
}

export type BattleEvent =
  | { t: 'turn'; side: Side }
  | { t: 'skill'; side: Side; skill: 'unarmor'; armor: Pool; atk: Pool; stamina: number }
  | {
      t: 'attack';
      side: Side;
      seg: number;
      segs: number;
      faces: number[];
      /** 「罗兰之声」追加的骰子点数（未触发为 null） */
      echo: number | null;
      mod: number;
      total: number;
    }
  | { t: 'dodge'; side: Side; faces: number[]; total: number; success: boolean }
  | { t: 'defend'; side: Side; faces: number[]; total: number; success: boolean; damage: number; armor: Pool; hp: number }
  | { t: 'drain'; side: Side; amount: number; stamina: number }
  | { t: 'group'; side: Side; group: number }
  | { t: 'end'; winner: Side };

function makeUnit(side: Side, spec: UnitSpec): Unit {
  const baseGroup = spec.group ?? 0;
  return {
    side,
    spec,
    atk: [...spec.atk],
    armor: [...spec.def],
    dodge: [...spec.dodge],
    hp: spec.hp,
    maxHp: spec.maxHp,
    spd: spec.spd,
    gauge: 0,
    baseGroup,
    group: baseGroup,
    unarmored: false,
    actions: 0,
  };
}

/** 群体随血量瓦解：群体 N 的单位每损失 1/(N+1) 的最大 HP，群体层数 −1（GDD 第 5 节） */
export function groupFor(baseGroup: number, hp: number, maxHp: number): number {
  if (baseGroup <= 0) return 0;
  const lost = Math.max(0, maxHp - Math.max(0, hp));
  return Math.max(0, baseGroup - Math.floor((lost * (baseGroup + 1)) / maxHp));
}

/** 「罗兰之声」：取原始骰面中最高的一组对子，追加一颗同点数的骰子（不连锁，只触发一次） */
export function rolandsEcho(faces: number[]): number | null {
  const pairs = faces.filter((v, i) => faces.indexOf(v) !== i);
  return pairs.length ? Math.max(...pairs) : null;
}

export interface BattleOptions {
  /** 轮到玩家行动且技能可用时调用，返回 true 则自动发动（模拟器 / 预测用） */
  autoSkill?: (b: Battle) => boolean;
}

export class Battle {
  readonly hero: Unit;
  readonly enemy: Unit;
  /** 玩家当前精力（技能消耗、怪物技能扣除都作用在这里，战斗结束后写回） */
  stamina: number;
  skillQueued = false;
  skillUsed = false;
  over = false;
  winner: Side | null = null;
  private pending: Unit[] = [];

  constructor(
    heroSpec: UnitSpec,
    enemySpec: UnitSpec,
    private readonly rng: Rng,
    stamina: number,
    private readonly opts: BattleOptions = {},
  ) {
    this.hero = makeUnit('hero', heroSpec);
    this.enemy = makeUnit('enemy', enemySpec);
    this.stamina = stamina;
  }

  /** 技能当前是否可以排队（本场没用过、精力足够） */
  canQueueSkill(): boolean {
    return !!this.hero.spec.unarmor && !this.skillUsed && !this.over && this.stamina >= UNARMOR_COST;
  }

  /** 常驻技能按钮：按下后在下一次轮到玩家行动时发动 */
  queueSkill(): boolean {
    if (!this.canQueueSkill()) return false;
    this.skillQueued = true;
    return true;
  }

  /** 推进到下一次行动并结算，返回这次行动产生的事件。 */
  next(): BattleEvent[] {
    if (this.over) return [];
    if (!this.pending.length) this.pending = advance([this.hero, this.enemy]);
    const u = this.pending.shift()!;
    const target = u === this.hero ? this.enemy : this.hero;
    const events: BattleEvent[] = [{ t: 'turn', side: u.side }];

    if (u === this.hero && this.canQueueSkill() && (this.skillQueued || this.opts.autoSkill?.(this))) {
      this.unarmor(events);
    }

    const segs = 1 + u.group;
    for (let seg = 0; seg < segs && !this.over; seg++) this.strike(u, target, seg, segs, events);

    u.gauge -= GAUGE;
    u.actions++;
    return events;
  }

  /** 一口气打完（模拟器 / 预测用） */
  runToEnd(maxActions = 400): void {
    while (!this.over && this.hero.actions + this.enemy.actions < maxActions) this.next();
    if (!this.over) {
      // 理论上不会发生：防止异常数值导致死循环
      this.over = true;
      this.winner = 'enemy';
    }
  }

  /** 未来 n 次行动的顺序（ATB 没有随机成分，可以提前算出） */
  previewOrder(n: number): Side[] {
    const units = [this.hero, this.enemy].map((u) => ({ ...u }));
    const order: Side[] = this.pending.map((u) => u.side);
    // 已经排进队列的单位，视为已经行动过（行动条先扣掉）
    for (const p of this.pending) units.find((u) => u.side === p.side)!.gauge -= GAUGE;
    while (order.length < n) {
      const ready = advance(units);
      for (const u of ready) {
        order.push(u.side);
        u.gauge -= GAUGE;
      }
    }
    return order.slice(0, n);
  }

  private unarmor(events: BattleEvent[]): void {
    const u = this.hero;
    this.skillQueued = false;
    this.skillUsed = true;
    this.stamina -= UNARMOR_COST;
    u.unarmored = true;
    u.dodge = [];
    u.armor = halve(u.armor);
    u.atk = [...u.atk, 6];
    events.push({ t: 'skill', side: 'hero', skill: 'unarmor', armor: [...u.armor], atk: [...u.atk], stamina: this.stamina });
  }

  private strike(att: Unit, def: Unit, seg: number, segs: number, events: BattleEvent[]): void {
    const faces = rollFaces(att.atk, this.rng);
    const echo = att.spec.rolandsVoice ? rolandsEcho(faces) : null;
    const mod = att.spec.atkMod ?? 0;
    const total = Math.max(0, sum(faces) + (echo ?? 0) + mod);
    events.push({ t: 'attack', side: att.side, seg, segs, faces, echo, mod, total });

    // 闪避：A ≤ E 则本段落空，护甲不变（Q8）。没有闪避骰时 E = 0。
    const dodgeFaces = rollFaces(def.dodge, this.rng);
    const dodgeTotal = def.dodge.length ? Math.max(0, sum(dodgeFaces) + (def.spec.dodgeMod ?? 0)) : 0;
    if (total <= dodgeTotal) {
      events.push({ t: 'dodge', side: def.side, faces: dodgeFaces, total: dodgeTotal, success: true });
      return;
    }
    events.push({ t: 'dodge', side: def.side, faces: dodgeFaces, total: dodgeTotal, success: false });

    // 防御：A > D 失败，受到 A − D 伤害、护甲 −2 级；否则成功、护甲 −1 级。
    const defFaces = rollFaces(def.armor, this.rng);
    const defTotal = Math.max(0, sum(defFaces) + (def.spec.defMod ?? 0));
    const broken = total > defTotal;
    const damage = broken ? total - defTotal : 0;
    def.hp -= damage;
    def.armor = wear(def.armor, broken ? 2 : 1);
    events.push({
      t: 'defend',
      side: def.side,
      faces: defFaces,
      total: defTotal,
      success: !broken,
      damage,
      armor: [...def.armor],
      hp: Math.max(0, def.hp),
    });

    if (broken && def === this.hero && att.spec.drainStamina) {
      const amount = Math.min(this.stamina, att.spec.drainStamina);
      this.stamina -= amount;
      events.push({ t: 'drain', side: 'hero', amount, stamina: this.stamina });
    }

    if (def.baseGroup > 0) {
      const g = groupFor(def.baseGroup, def.hp, def.maxHp);
      if (g !== def.group) {
        def.group = g;
        events.push({ t: 'group', side: def.side, group: g });
      }
    }

    if (def.hp <= 0) {
      def.hp = 0;
      this.over = true;
      this.winner = att.side;
      events.push({ t: 'end', winner: att.side });
    }
  }
}

/**
 * ATB 推进：行动条每刻 += 速度，推进到有人满条为止。
 * 同一刻多人满条：溢出多者先 → 速度高者先 → 玩家优先。
 */
function advance(units: Unit[]): Unit[] {
  const ticks = Math.max(0, Math.min(...units.map((u) => Math.ceil((GAUGE - u.gauge) / u.spd))));
  for (const u of units) u.gauge += ticks * u.spd;
  return units
    .filter((u) => u.gauge >= GAUGE)
    .sort((a, b) => b.gauge - a.gauge || b.spd - a.spd || (a.side === 'hero' ? -1 : 1));
}

// ---------- 概率预测（怪物手册 / 交战确认 / 数值模拟器） ----------

export type SkillPolicy = 'never' | 'first' | 'broken';

export function skillPolicy(policy: SkillPolicy): BattleOptions['autoSkill'] {
  if (policy === 'never') return () => false;
  if (policy === 'first') return () => true;
  // 护甲磨损到不足初始一半时卸甲（GDD 6.2：护甲越破，卸甲越便宜）
  return (b) => poolLevel(b.hero.armor) * 2 < poolLevel(b.hero.spec.def);
}

export interface Prediction {
  winRate: number;
  avgLoss: number;
  p90Loss: number;
  avgHeroActions: number;
  avgEnemyActions: number;
  /** 发动了技能的对局占比 */
  skillRate: number;
}

export function predict(
  hero: UnitSpec,
  enemy: UnitSpec,
  stamina: number,
  n = 1000,
  policy: SkillPolicy = 'never',
  rng: Rng = mathRng,
): Prediction {
  const losses: number[] = [];
  let wins = 0;
  let heroActs = 0;
  let enemyActs = 0;
  let skills = 0;
  const autoSkill = skillPolicy(policy);
  for (let i = 0; i < n; i++) {
    const b = new Battle(hero, enemy, rng, stamina, { autoSkill });
    b.runToEnd();
    if (b.winner === 'hero') wins++;
    losses.push(hero.hp - Math.max(0, b.hero.hp));
    heroActs += b.hero.actions;
    enemyActs += b.enemy.actions;
    if (b.skillUsed) skills++;
  }
  losses.sort((a, b) => a - b);
  return {
    winRate: wins / n,
    avgLoss: sum(losses) / n,
    p90Loss: losses[Math.min(n - 1, Math.floor(n * 0.9))],
    avgHeroActions: heroActs / n,
    avgEnemyActions: enemyActs / n,
    skillRate: skills / n,
  };
}
