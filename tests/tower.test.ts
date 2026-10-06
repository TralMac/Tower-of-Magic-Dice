import { describe, expect, it } from 'vitest';
import { FLOORS, MONSTER_TILES } from '../src/core/data/floors';
import { HEROES } from '../src/core/data/heroes';
import { MONSTERS } from '../src/core/data/monsters';
import { altarPrice, CAMPFIRE, Game, newGameState, STAMINA_FLOOR, type Pos } from '../src/core/tower';

const at = (x: number, y: number): Pos => ({ x, y });

/** 把一层地图里的某个格子换掉，方便构造测试场景 */
function put(g: Game, p: Pos, ch: string) {
  g.setTile(p, ch);
}

describe('地图数据', () => {
  it('每层都是 11 × 11，只用已知图例', () => {
    const legend = new Set('#.@<>yuYUhHadwc$Axne'.split('').concat(Object.keys(MONSTER_TILES)));
    for (const rows of FLOORS) {
      expect(rows.length).toBe(11);
      for (const row of rows) {
        expect(row.length).toBe(11);
        for (const ch of row) expect(legend.has(ch), `未知图例 ${ch}`).toBe(true);
      }
    }
  });

  it('每种怪物图例都有数据', () => {
    for (const id of Object.values(MONSTER_TILES)) expect(MONSTERS[id]).toBeDefined();
  });

  it('楼梯成对：除了第 1 层都有下楼梯，每层都有上楼梯', () => {
    FLOORS.forEach((rows, i) => {
      const text = rows.join('');
      expect(text.includes('>')).toBe(true);
      expect(text.includes('<')).toBe(i > 0);
    });
  });

  it('打开所有门、打倒所有怪物后，每层的格子都可以到达', () => {
    FLOORS.forEach((rows, f) => {
      const start = f === 0 ? '@' : '<';
      const sy = rows.findIndex((r) => r.includes(start));
      const sx = rows[sy].indexOf(start);
      const seen = new Set([`${sx},${sy}`]);
      const queue = [[sx, sy]];
      // 营火、商人、祭坛等物件挡路，但本身可以被「到达」
      const blocking = new Set('c$Axne'.split(''));
      while (queue.length) {
        const [x, y] = queue.shift()!;
        for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
          const nx = x + dx;
          const ny = y + dy;
          const ch = rows[ny]?.[nx];
          if (!ch || ch === '#' || seen.has(`${nx},${ny}`)) continue;
          seen.add(`${nx},${ny}`);
          if (!blocking.has(ch)) queue.push([nx, ny]);
        }
      }
      rows.forEach((row, y) =>
        [...row].forEach((ch, x) => {
          if (ch !== '#') expect(seen.has(`${x},${y}`), `第 ${f + 1} 层 (${x},${y}) '${ch}' 到不了`).toBe(true);
        }),
      );
    });
  });
});

describe('移动与精力', () => {
  it('起点在第 1 层，满血满精力', () => {
    const s = newGameState(1);
    expect(s.floor).toBe(0);
    expect(FLOORS[0][s.pos.y][s.pos.x]).toBe('@');
    expect(s.hero.hp).toBe(s.hero.maxHp);
    expect(s.hero.stamina).toBe(HEROES.warrior.maxStamina);
  });

  it('每走一格 −1 精力', () => {
    const g = Game.create(1);
    const { x, y } = g.state.pos;
    expect(g.stepTo(at(x + 1, y))).toEqual([{ kind: 'moved' }]);
    expect(g.hero.stamina).toBe(HEROES.warrior.maxStamina - 1);
  });

  it('寻路停在门 / 怪物前，不穿过它们；路线精力只算真正的移动', () => {
    const g = Game.create(1);
    g.state.pos = at(5, 9);
    put(g, at(4, 9), '.');
    // (1,9) 是黄钥匙：路线 (4,9)(3,9)(2,9)(1,9)，4 步都会移动
    const path = g.findPath(at(1, 9))!;
    expect(path.length).toBe(4);
    expect(g.pathCost(path)).toBe(4);
    // 门：最后一步是开门，不移动
    put(g, at(2, 9), 'Y');
    const toDoor = g.findPath(at(2, 9))!;
    expect(toDoor.length).toBe(3);
    expect(g.pathCost(toDoor)).toBe(2);
    // 门后面的格子走不过去
    expect(g.findPath(at(1, 9))).toBeNull();
  });

  it('没有钥匙打不开门，有钥匙开门不移动', () => {
    const g = Game.create(1);
    g.state.pos = at(5, 9);
    put(g, at(4, 9), 'Y');
    expect(g.stepTo(at(4, 9))).toEqual([{ kind: 'door', color: 'yellow', opened: false }]);
    g.hero.keys.yellow = 1;
    expect(g.stepTo(at(4, 9))).toEqual([{ kind: 'door', color: 'yellow', opened: true }]);
    expect(g.state.pos).toEqual(at(5, 9));
    expect(g.tile(at(4, 9))).toBe('.');
  });

  it('血瓶不能超过 HP 上限（Q22）', () => {
    const g = Game.create(1);
    g.state.pos = at(5, 9);
    put(g, at(4, 9), 'h');
    g.hero.hp = 45;
    g.stepTo(at(4, 9));
    expect(g.hero.hp).toBe(50);
  });

  it('上下楼梯', () => {
    const g = Game.create(1);
    g.state.pos = at(5, 1);
    put(g, at(5, 1), '.');
    const out = g.stepTo(at(5, 0));
    expect(out[0]).toEqual({ kind: 'stairs', dir: 'up', floor: 1 });
    expect(g.tile(g.state.pos)).toBe('<');
    g.state.pos = at(5, 9);
    g.stepTo(at(5, 10));
    expect(g.state.floor).toBe(0);
    expect(g.tile(g.state.pos)).toBe('>');
  });
});

describe('昏迷判定（GDD 10.1）', () => {
  it('结果分档与精力上限保底', () => {
    for (let seed = 1; seed < 400; seed++) {
      const g = Game.create(seed);
      g.hero.stamina = 0;
      g.hero.maxStamina = STAMINA_FLOOR + 2;
      const r = g.checkFaint()!;
      if (r.outcome === 'death') {
        expect(r.roll).toBe(1);
        expect(g.state.status).toBe('dead');
        continue;
      }
      if (r.roll <= 4) expect(r).toMatchObject({ outcome: 'startled', stamina: 10 });
      else if (r.roll <= 11) expect(r.outcome).toBe('rest');
      else expect(r).toMatchObject({ outcome: 'great', maxStamina: STAMINA_FLOOR + 2 });
      if (r.outcome !== 'great') expect(r.maxStamina).toBe(STAMINA_FLOOR);
      expect(r.stamina).toBeLessThanOrEqual(r.maxStamina);
    }
  });

  it('精力还有剩时不判定', () => {
    expect(Game.create(1).checkFaint()).toBeNull();
  });

  it('走路把精力走到 0 时立刻判定', () => {
    const g = Game.create(3);
    g.hero.stamina = 1;
    const { x, y } = g.state.pos;
    const out = g.stepTo(at(x + 1, y));
    expect(out[1]?.kind).toBe('faint');
  });
});

describe('营火', () => {
  it('每次休息 +40 精力、+30% HP 上限，3 次后熄灭，柴火可以续 1 次', () => {
    const g = Game.create(1);
    const fire = at(0, 0);
    g.hero.stamina = 10;
    g.hero.hp = 10;
    expect(g.rest(fire)).toEqual({ stamina: CAMPFIRE.stamina, hp: 15 });
    g.rest(fire);
    g.rest(fire);
    expect(g.campfireUses(fire)).toBe(0);
    expect(g.rest(fire)).toBeNull();
    g.hero.firewood = 1;
    expect(g.addFirewood(fire)).toBe(true);
    expect(g.campfireUses(fire)).toBe(1);
  });
});

describe('魔力结晶', () => {
  it('祭坛价格逐次上涨', () => {
    const g = Game.create(1);
    g.hero.crystals = 100;
    expect(g.altarPrice()).toBe(altarPrice(0));
    expect(g.altar('atk')).toBe(true);
    expect(g.hero.atk).toEqual([7, 6]);
    expect(g.altarPrice()).toBe(30);
    expect(g.altar('hp')).toBe(true);
    expect(g.hero.maxHp).toBe(60);
    expect(g.hero.crystals).toBe(50);
  });

  it('结晶不够买不了', () => {
    const g = Game.create(1);
    expect(g.altar('def')).toBe(false);
    expect(g.buy('yellowKey')).toBe(false);
  });

  it('置换点', () => {
    const g = Game.create(1);
    g.hero.keys.yellow = 3;
    expect(g.exchange('keysmith')).toBe(true);
    expect(g.hero.keys).toEqual({ yellow: 0, blue: 1 });
    expect(g.exchange('sellBlue')).toBe(true);
    expect(g.hero.crystals).toBe(15);
    expect(g.exchange('bloodPact')).toBe(true);
    expect(g.hero.hp).toBe(40);
    expect(g.hero.crystals).toBe(20);
  });
});

describe('战斗结算', () => {
  it('交战扣 3 精力；获胜清掉怪物、拿结晶', () => {
    const g = Game.create(5);
    const pos = at(4, 9); // 第 1 层的史莱姆
    g.state.pos = at(5, 9);
    const out = g.stepTo(pos);
    expect(out[0].kind).toBe('monster');
    const b = g.startBattle(MONSTERS.slime);
    expect(g.hero.stamina).toBe(HEROES.warrior.maxStamina - 3);
    b.runToEnd();
    const res = g.finishBattle(b, pos);
    expect(b.winner).toBe('hero');
    expect(res.crystals).toBe(2);
    expect(g.tile(pos)).toBe('.');
  });

  it('存档后读档，接下来的骰子完全一样', () => {
    const g = Game.create(77);
    g.state.pos = at(5, 9);
    const saved = g.serialize();
    const fight = (game: Game) => {
      const b = game.startBattle(MONSTERS.skeleton);
      const log = [];
      while (!b.over) log.push(...b.next());
      return log;
    };
    expect(fight(new Game(saved))).toEqual(fight(new Game(JSON.parse(JSON.stringify(saved)))));
  });
});
