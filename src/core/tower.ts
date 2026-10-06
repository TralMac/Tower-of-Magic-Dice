// 魔塔探索规则核心：地图、移动与精力、寻路、拾取、门、营火、昏迷判定、
// 魔力结晶（祭坛 / 商人 / 置换点）、事件、战斗的开始与结算（GDD 1 / 10 / 10.1 / 10.2）。

import { Battle, type BattleOptions, type UnitSpec } from './combat';
import { parsePool, upgrade, type Pool } from './dice';
import { HEROES } from './data/heroes';
import { CAMPFIRE_USES, FLOORS, MONSTER_TILES } from './data/floors';
import { MONSTERS, type MonsterDef } from './data/monsters';
import { randomSeed, rollDie, SeededRng } from './rng';

export const SAVE_VERSION = 1;

// ---------- 数值（初稿，见 GDD 10.1 / 10.2） ----------
export const COST = {
  step: 1,
  battle: 3,
};
export const CAMPFIRE = { uses: 3, stamina: 40, hpRatio: 0.3 };
export const STAMINA_FLOOR = 30;
export const POTION = { h: 15, H: 40 };
export const MERCHANT: Record<MerchantItem, number> = { yellowKey: 10, blueKey: 30, potion: 15, firewood: 20 };
export const EXCHANGE = {
  spring: { crystals: 10, stamina: 25 },
  keysmith: { yellow: 3 },
  sellYellow: 5,
  sellBlue: 15,
  bloodPact: { hp: 10, crystals: 5 },
};
export const altarPrice = (count: number): number => 20 + 10 * count;

export type MerchantItem = 'yellowKey' | 'blueKey' | 'potion' | 'firewood';
export type AltarOption = 'atk' | 'def' | 'hp' | 'stamina';
export type ExchangeOption = 'spring' | 'keysmith' | 'sellYellow' | 'sellBlue' | 'bloodPact';
export type EventChoice = 'remember' | 'forget';
export type ObjectKind = 'campfire' | 'merchant' | 'altar' | 'exchanger' | 'sign' | 'event';

export interface Pos {
  x: number;
  y: number;
}

export interface HeroState {
  id: string;
  atk: Pool;
  def: Pool;
  dodge: Pool;
  hp: number;
  maxHp: number;
  spd: number;
  stamina: number;
  maxStamina: number;
  crystals: number;
  keys: { yellow: number; blue: number };
  firewood: number;
  traits: string[];
  altarCount: number;
}

export interface GameState {
  v: number;
  seed: number;
  floor: number;
  pos: Pos;
  hero: HeroState;
  /** 每层的地图（会被修改：拾取、开门、击杀） */
  grids: string[][];
  /** 营火剩余次数，key = "层,x,y" */
  campfires: Record<string, number>;
  status: 'playing' | 'dead' | 'won';
  stats: { steps: number; battles: number; faints: number };
}

export type FaintResult =
  | { roll: 1; outcome: 'death' }
  | { roll: number; outcome: 'startled' | 'rest' | 'great'; stamina: number; maxStamina: number };

export type StepOutcome =
  | { kind: 'moved' }
  | { kind: 'blocked' }
  | { kind: 'pickup'; item: string }
  | { kind: 'door'; color: 'yellow' | 'blue'; opened: boolean }
  | { kind: 'monster'; monster: MonsterDef; at: Pos }
  | { kind: 'stairs'; dir: 'up' | 'down'; floor: number }
  | { kind: 'object'; obj: ObjectKind; at: Pos }
  | { kind: 'won' }
  | { kind: 'faint'; result: FaintResult };

const PICKUPS = new Set(['y', 'u', 'h', 'H', 'a', 'd', 'w']);
const OBJECTS: Record<string, ObjectKind> = {
  c: 'campfire',
  $: 'merchant',
  A: 'altar',
  x: 'exchanger',
  n: 'sign',
  e: 'event',
};

const key = (f: number, p: Pos) => `${f},${p.x},${p.y}`;
const DIRS: Pos[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

export function newGameState(seed = randomSeed(), heroId = 'warrior'): GameState {
  const h = HEROES[heroId];
  const grids = FLOORS.map((rows) => [...rows]);
  let pos: Pos = { x: 0, y: 0 };
  grids[0] = grids[0].map((row, y) => {
    const x = row.indexOf('@');
    if (x >= 0) pos = { x, y };
    return row.replace('@', '.');
  });
  return {
    v: SAVE_VERSION,
    seed: seed >>> 0,
    floor: 0,
    pos,
    hero: {
      id: h.id,
      atk: parsePool(h.atk),
      def: parsePool(h.def),
      dodge: parsePool(h.dodge),
      hp: h.maxHp,
      maxHp: h.maxHp,
      spd: h.spd,
      stamina: h.maxStamina,
      maxStamina: h.maxStamina,
      crystals: 0,
      keys: { yellow: 0, blue: 0 },
      firewood: 0,
      traits: [],
      altarCount: 0,
    },
    grids,
    campfires: {},
    status: 'playing',
    stats: { steps: 0, battles: 0, faints: 0 },
  };
}

export function monsterSpec(m: MonsterDef): UnitSpec {
  return {
    id: m.id,
    atk: parsePool(m.atk),
    def: parsePool(m.def),
    dodge: parsePool(m.dodge),
    hp: m.hp,
    maxHp: m.hp,
    spd: m.spd,
    group: m.group,
    drainStamina: m.drainStamina,
    boss: m.boss,
  };
}

/** 游戏运行时：状态 + 随机数。存档时把随机数状态写回 seed（Q9：读档后同样的操作得到同样的骰子）。 */
export class Game {
  state: GameState;
  rng: SeededRng;

  constructor(state: GameState) {
    this.state = state;
    this.rng = new SeededRng(state.seed);
  }

  static create(seed?: number): Game {
    return new Game(newGameState(seed));
  }

  serialize(): GameState {
    return JSON.parse(JSON.stringify({ ...this.state, seed: this.rng.state }));
  }

  get hero(): HeroState {
    return this.state.hero;
  }

  // ---------- 地图 ----------

  tile(p: Pos, floor = this.state.floor): string {
    const row = this.state.grids[floor]?.[p.y];
    if (!row || p.x < 0 || p.x >= row.length) return '#';
    return row[p.x];
  }

  setTile(p: Pos, ch: string, floor = this.state.floor): void {
    const row = this.state.grids[floor][p.y];
    this.state.grids[floor][p.y] = row.slice(0, p.x) + ch + row.slice(p.x + 1);
  }

  get width(): number {
    return this.state.grids[this.state.floor][0].length;
  }

  get height(): number {
    return this.state.grids[this.state.floor].length;
  }

  monsterAt(p: Pos): MonsterDef | null {
    const id = MONSTER_TILES[this.tile(p)];
    return id ? MONSTERS[id] : null;
  }

  campfireUses(p: Pos): number {
    const k = key(this.state.floor, p);
    return this.state.campfires[k] ?? CAMPFIRE_USES[k] ?? CAMPFIRE.uses;
  }

  /** 本层所有怪物（怪物手册） */
  floorMonsters(): MonsterDef[] {
    const seen = new Map<string, MonsterDef>();
    for (const row of this.state.grids[this.state.floor]) {
      for (const ch of row) {
        const id = MONSTER_TILES[ch];
        if (id) seen.set(id, MONSTERS[id]);
      }
    }
    return [...seen.values()];
  }

  // ---------- 寻路 ----------

  /**
   * 自动寻路：中间格只能是空地；目标格可以是任何非墙的格子（道具、门、怪物、营火……），
   * 走到它面前时再交互（platform.md 第 4 节）。返回不含起点的路径。
   */
  findPath(target: Pos): Pos[] | null {
    if (this.tile(target) === '#') return null;
    const { pos } = this.state;
    if (pos.x === target.x && pos.y === target.y) return null;
    const prev = new Map<string, Pos | null>([[`${pos.x},${pos.y}`, null]]);
    const queue: Pos[] = [pos];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const d of DIRS) {
        const n = { x: cur.x + d.x, y: cur.y + d.y };
        const k = `${n.x},${n.y}`;
        if (prev.has(k)) continue;
        const ch = this.tile(n);
        if (ch === '#') continue;
        const isTarget = n.x === target.x && n.y === target.y;
        if (!isTarget && ch !== '.') continue;
        prev.set(k, cur);
        if (isTarget) {
          const path: Pos[] = [];
          let p: Pos | null = n;
          while (p && !(p.x === pos.x && p.y === pos.y)) {
            path.unshift(p);
            p = prev.get(`${p.x},${p.y}`) ?? null;
          }
          return path;
        }
        queue.push(n);
      }
    }
    return null;
  }

  /** 走这条路要花多少精力（停在门、怪物、营火等前面的那一步不算移动） */
  pathCost(path: Pos[]): number {
    if (!path.length) return 0;
    const last = this.tile(path[path.length - 1]);
    const lastMoves = last === '.' || last === '<' || last === '>' || PICKUPS.has(last);
    return (path.length - 1 + (lastMoves ? 1 : 0)) * COST.step;
  }

  // ---------- 移动 ----------

  /** 朝相邻格子走一步（或与它交互）。返回发生的事情；精力耗尽时附带昏迷判定。 */
  stepTo(target: Pos): StepOutcome[] {
    const s = this.state;
    if (s.status !== 'playing') return [{ kind: 'blocked' }];
    const dx = Math.abs(target.x - s.pos.x);
    const dy = Math.abs(target.y - s.pos.y);
    if (dx + dy !== 1) return [{ kind: 'blocked' }];

    const ch = this.tile(target);
    if (ch === '#') return [{ kind: 'blocked' }];

    const monster = this.monsterAt(target);
    if (monster) return [{ kind: 'monster', monster, at: target }];

    if (ch === 'Y' || ch === 'U') {
      const color = ch === 'Y' ? 'yellow' : 'blue';
      if (this.hero.keys[color] <= 0) return [{ kind: 'door', color, opened: false }];
      this.hero.keys[color]--;
      this.setTile(target, '.');
      return [{ kind: 'door', color, opened: true }];
    }

    const obj = OBJECTS[ch];
    if (obj) return [{ kind: 'object', obj, at: target }];

    // 以下都是真正的移动：花 1 精力
    const out: StepOutcome[] = [];
    this.move(target);
    if (PICKUPS.has(ch)) {
      this.pickup(ch);
      this.setTile(target, '.');
      out.push({ kind: 'pickup', item: ch });
    } else if (ch === '>') {
      if (s.floor + 1 >= s.grids.length) {
        s.status = 'won';
        return [{ kind: 'won' }];
      }
      this.changeFloor(s.floor + 1, '<');
      out.push({ kind: 'stairs', dir: 'up', floor: s.floor });
    } else if (ch === '<') {
      this.changeFloor(s.floor - 1, '>');
      out.push({ kind: 'stairs', dir: 'down', floor: s.floor });
    } else {
      out.push({ kind: 'moved' });
    }
    const faint = this.checkFaint();
    if (faint) out.push({ kind: 'faint', result: faint });
    return out;
  }

  private move(target: Pos): void {
    this.state.pos = { ...target };
    this.hero.stamina = Math.max(0, this.hero.stamina - COST.step);
    this.state.stats.steps++;
  }

  private changeFloor(floor: number, arriveOn: '<' | '>'): void {
    this.state.floor = floor;
    const grid = this.state.grids[floor];
    for (let y = 0; y < grid.length; y++) {
      const x = grid[y].indexOf(arriveOn);
      if (x >= 0) {
        this.state.pos = { x, y };
        return;
      }
    }
  }

  private pickup(ch: string): void {
    const h = this.hero;
    switch (ch) {
      case 'y':
        h.keys.yellow++;
        break;
      case 'u':
        h.keys.blue++;
        break;
      case 'h':
      case 'H':
        h.hp = Math.min(h.maxHp, h.hp + POTION[ch]); // 血瓶不能超过 HP 上限（Q22）
        break;
      case 'a':
        h.atk = upgrade(h.atk);
        break;
      case 'd':
        h.def = upgrade(h.def);
        break;
      case 'w':
        h.firewood++;
        break;
    }
  }

  // ---------- 精力耗尽：昏迷判定（GDD 10.1） ----------

  /** 精力为 0 时投 1d12。大失败 / 大成功只看骰面原始点数。 */
  checkFaint(): FaintResult | null {
    const h = this.hero;
    if (h.stamina > 0 || this.state.status !== 'playing') return null;
    this.state.stats.faints++;
    const roll = rollDie(12, this.rng);
    if (roll === 1) {
      this.state.status = 'dead';
      return { roll: 1, outcome: 'death' };
    }
    let gain: number;
    let outcome: 'startled' | 'rest' | 'great';
    if (roll <= 4) {
      gain = 10;
      outcome = 'startled';
    } else if (roll <= 11) {
      gain = roll * 5;
      outcome = 'rest';
    } else {
      gain = 60;
      outcome = 'great';
    }
    if (outcome !== 'great') h.maxStamina = Math.max(STAMINA_FLOOR, h.maxStamina - 5);
    h.stamina = Math.min(h.maxStamina, gain);
    return { roll, outcome, stamina: h.stamina, maxStamina: h.maxStamina };
  }

  // ---------- 战斗 ----------

  heroSpec(): UnitSpec {
    const h = this.hero;
    const def = HEROES[h.id];
    return {
      id: h.id,
      atk: [...h.atk],
      def: [...h.def],
      dodge: [...h.dodge],
      hp: h.hp,
      maxHp: h.maxHp,
      spd: h.spd,
      defMod: h.traits.includes('tough') ? 1 : 0,
      rolandsVoice: def.rolandsVoice,
      unarmor: def.unarmor,
    };
  }

  /** 交战：扣进入战斗的精力，返回使用存档随机数的战斗 */
  startBattle(monster: MonsterDef, opts?: BattleOptions): Battle {
    this.hero.stamina = Math.max(0, this.hero.stamina - COST.battle);
    this.state.stats.battles++;
    return new Battle(this.heroSpec(), monsterSpec(monster), this.rng, this.hero.stamina, opts);
  }

  /** 结算战斗（含撤退）。战斗中不会昏迷，结束后精力为 0 时立刻判定。 */
  finishBattle(battle: Battle, at: Pos): { crystals: number; faint: FaintResult | null } {
    const h = this.hero;
    h.hp = Math.max(0, battle.hero.hp);
    h.stamina = battle.stamina;
    let crystals = 0;
    if (battle.winner === 'hero') {
      const m = this.monsterAt(at);
      if (m) {
        crystals = m.crystals;
        h.crystals += crystals;
      }
      this.setTile(at, '.');
    } else if (battle.winner === 'enemy' || h.hp <= 0) {
      this.state.status = 'dead';
      return { crystals, faint: null };
    }
    return { crystals, faint: this.checkFaint() };
  }

  // ---------- 营火 ----------

  /** 休息：恢复 40 精力 + 30% HP 上限；营火用完会熄灭（GDD 10.1） */
  rest(at: Pos): { stamina: number; hp: number } | null {
    const k = key(this.state.floor, at);
    const uses = this.campfireUses(at);
    if (uses <= 0) return null;
    this.state.campfires[k] = uses - 1;
    const h = this.hero;
    const before = { stamina: h.stamina, hp: h.hp };
    h.stamina = Math.min(h.maxStamina, h.stamina + CAMPFIRE.stamina);
    h.hp = Math.min(h.maxHp, h.hp + Math.ceil(h.maxHp * CAMPFIRE.hpRatio));
    return { stamina: h.stamina - before.stamina, hp: h.hp - before.hp };
  }

  /** 用柴火给营火 +1 次 */
  addFirewood(at: Pos): boolean {
    if (this.hero.firewood <= 0) return false;
    this.hero.firewood--;
    this.state.campfires[key(this.state.floor, at)] = this.campfireUses(at) + 1;
    return true;
  }

  // ---------- 魔力结晶 ----------

  altarPrice(): number {
    return altarPrice(this.hero.altarCount);
  }

  altar(option: AltarOption): boolean {
    const h = this.hero;
    const price = this.altarPrice();
    if (h.crystals < price) return false;
    h.crystals -= price;
    h.altarCount++;
    if (option === 'atk') h.atk = upgrade(h.atk);
    if (option === 'def') h.def = upgrade(h.def);
    if (option === 'hp') {
      h.maxHp += 10;
      h.hp += 10;
    }
    if (option === 'stamina') {
      h.maxStamina += 10;
      h.stamina += 10;
    }
    return true;
  }

  buy(item: MerchantItem): boolean {
    const h = this.hero;
    const price = MERCHANT[item];
    if (h.crystals < price) return false;
    if (item === 'potion' && h.hp >= h.maxHp) return false;
    h.crystals -= price;
    if (item === 'yellowKey') h.keys.yellow++;
    if (item === 'blueKey') h.keys.blue++;
    if (item === 'potion') h.hp = Math.min(h.maxHp, h.hp + POTION.h);
    if (item === 'firewood') h.firewood++;
    return true;
  }

  canExchange(option: ExchangeOption): boolean {
    const h = this.hero;
    switch (option) {
      case 'spring':
        return h.crystals >= EXCHANGE.spring.crystals && h.stamina < h.maxStamina;
      case 'keysmith':
        return h.keys.yellow >= EXCHANGE.keysmith.yellow;
      case 'sellYellow':
        return h.keys.yellow > 0;
      case 'sellBlue':
        return h.keys.blue > 0;
      case 'bloodPact':
        return h.hp > EXCHANGE.bloodPact.hp;
    }
  }

  exchange(option: ExchangeOption): boolean {
    if (!this.canExchange(option)) return false;
    const h = this.hero;
    switch (option) {
      case 'spring':
        h.crystals -= EXCHANGE.spring.crystals;
        h.stamina = Math.min(h.maxStamina, h.stamina + EXCHANGE.spring.stamina);
        break;
      case 'keysmith':
        h.keys.yellow -= EXCHANGE.keysmith.yellow;
        h.keys.blue++;
        break;
      case 'sellYellow':
        h.keys.yellow--;
        h.crystals += EXCHANGE.sellYellow;
        break;
      case 'sellBlue':
        h.keys.blue--;
        h.crystals += EXCHANGE.sellBlue;
        break;
      case 'bloodPact':
        h.hp -= EXCHANGE.bloodPact.hp;
        h.crystals += EXCHANGE.bloodPact.crystals;
        break;
    }
    return true;
  }

  // ---------- 事件 ----------

  /** 战士专属事件「磨坊的余烬」（warrior.md 第 8 节） */
  resolveEvent(at: Pos, choice: EventChoice): void {
    const h = this.hero;
    if (choice === 'remember') h.traits.push('tough');
    if (choice === 'forget') {
      h.maxStamina += 10;
      h.stamina += 10;
    }
    this.setTile(at, '.');
  }
}
