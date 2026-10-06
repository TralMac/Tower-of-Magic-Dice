import { describe, expect, it } from 'vitest';
import { Battle, groupFor, predict, rolandsEcho, UNARMOR_COST, type BattleEvent, type UnitSpec } from '../src/core/combat';
import { parsePool } from '../src/core/dice';
import { SeededRng, type Rng } from '../src/core/rng';

const unit = (over: Partial<UnitSpec> = {}): UnitSpec => ({
  id: 'u',
  atk: parsePool('2d6'),
  def: parsePool('1d6+1d4'),
  dodge: parsePool('1d4'),
  hp: 50,
  maxHp: 50,
  spd: 10,
  ...over,
});

/** 按顺序吐出指定骰面的假随机数：骰面 v（面数 f）→ (v − 0.5) / f */
function scripted(rolls: Array<[number, number]>): Rng {
  let i = 0;
  return {
    next() {
      const [v, f] = rolls[i++];
      return (v - 0.5) / f;
    },
  };
}

describe('罗兰之声', () => {
  it('对子追加一颗同点数的骰子，取最高的一组，只触发一次', () => {
    expect(rolandsEcho([4, 4])).toBe(4);
    expect(rolandsEcho([3, 5])).toBeNull();
    expect(rolandsEcho([6, 6, 6])).toBe(6);
    expect(rolandsEcho([2, 2, 5])).toBe(2);
  });

  it('4、4 → 攻击 = 4 + 4 + 4 = 12', () => {
    const hero = unit({ rolandsVoice: true, spd: 20 });
    const enemy = unit({ dodge: [], def: parsePool('1d4'), hp: 30, maxHp: 30 });
    // 玩家攻击 4,4；敌人无闪避骰；敌人防御 1
    const b = new Battle(hero, enemy, scripted([[4, 6], [4, 6], [1, 4]]), 100);
    const ev = b.next();
    const atk = ev.find((e) => e.t === 'attack') as Extract<BattleEvent, { t: 'attack' }>;
    expect(atk.echo).toBe(4);
    expect(atk.total).toBe(12);
    const def = ev.find((e) => e.t === 'defend') as Extract<BattleEvent, { t: 'defend' }>;
    expect(def.damage).toBe(11);
  });
});

describe('判定（GDD 第 4 节）', () => {
  it('A ≤ E 闪避成功，护甲不变（Q8）', () => {
    const hero = unit({ spd: 20 });
    const enemy = unit({ dodge: parsePool('1d6') });
    const b = new Battle(hero, enemy, scripted([[1, 6], [2, 6], [6, 6]]), 100);
    const ev = b.next();
    expect(ev.find((e) => e.t === 'dodge')).toMatchObject({ success: true });
    expect(ev.find((e) => e.t === 'defend')).toBeUndefined();
    expect(b.enemy.armor).toEqual([6, 4]);
  });

  it('防御成功护甲 −1 级，失败扣血并 −2 级', () => {
    const hero = unit({ spd: 20 });
    const enemy = unit({ dodge: [] });
    // 第一次：攻击 2+3=5，防御 6+4=10 → 成功，d6+d4 → d6+d3
    const b = new Battle(hero, enemy, scripted([[2, 6], [3, 6], [6, 6], [4, 4]]), 100);
    b.next();
    expect(b.enemy.armor).toEqual([6, 3]);
    expect(b.enemy.hp).toBe(50);
    // 第二次（玩家速度 20，连动）：攻击 6+5=11，防御 1+1=2 → 失败 9 伤害，d6+d3 → d6
    const b2 = new Battle(hero, enemy, scripted([[2, 6], [3, 6], [6, 6], [4, 4], [6, 6], [5, 6], [1, 6], [1, 3]]), 100);
    b2.next();
    b2.next();
    expect(b2.enemy.hp).toBe(41);
    expect(b2.enemy.armor).toEqual([6]);
  });

  it('攻击点数截断为 0，0 点必被闪避（Q7）', () => {
    const hero = unit({ atk: parsePool('1d2'), atkMod: -5, spd: 20 });
    const enemy = unit({ dodge: [] });
    const b = new Battle(hero, enemy, scripted([[2, 2]]), 100);
    const ev = b.next();
    expect(ev.find((e) => e.t === 'attack')).toMatchObject({ total: 0 });
    expect(ev.find((e) => e.t === 'dodge')).toMatchObject({ success: true, total: 0 });
  });
});

describe('卸甲', () => {
  it('轮到自己时发动：不占用行动，丢一半当前护甲、无法闪避、+1d6，扣 10 精力', () => {
    const hero = unit({ unarmor: true, spd: 20 });
    const enemy = unit({ hp: 200, maxHp: 200 });
    const b = new Battle(hero, enemy, new SeededRng(1), 30);
    expect(b.queueSkill()).toBe(true);
    const ev = b.next();
    expect(ev[0]).toEqual({ t: 'turn', side: 'hero' });
    expect(ev[1]).toMatchObject({ t: 'skill', skill: 'unarmor', armor: [5], atk: [6, 6, 6], stamina: 30 - UNARMOR_COST });
    expect(ev.some((e) => e.t === 'attack')).toBe(true); // 同一次行动里照常攻击
    expect(b.hero.dodge).toEqual([]);
    expect(b.canQueueSkill()).toBe(false); // 每场 1 次
  });

  it('精力不足时不能发动', () => {
    const b = new Battle(unit({ unarmor: true }), unit(), new SeededRng(1), UNARMOR_COST - 1);
    expect(b.queueSkill()).toBe(false);
  });
});

describe('群体', () => {
  it('群体 N 每次攻击 1 + N 段', () => {
    const b = new Battle(unit({ spd: 1 }), unit({ group: 2, spd: 30 }), new SeededRng(3), 100);
    const ev = b.next();
    expect(ev.filter((e) => e.t === 'attack').length).toBe(3);
  });

  it('群体随血量瓦解：每损失 1/(N+1) 最大 HP，群体 −1', () => {
    expect(groupFor(2, 18, 18)).toBe(2);
    expect(groupFor(2, 13, 18)).toBe(2);
    expect(groupFor(2, 12, 18)).toBe(1);
    expect(groupFor(2, 6, 18)).toBe(0);
    expect(groupFor(1, 4, 8)).toBe(0);
    expect(groupFor(0, 1, 8)).toBe(0);
  });
});

describe('ATB', () => {
  it('速度 10 对 14：我方每行动 5 次，对方行动 7 次', () => {
    const b = new Battle(unit({ spd: 10 }), unit({ spd: 14 }), new SeededRng(1), 100);
    const order = b.previewOrder(12);
    expect(order.join(' ')).toBe('enemy hero enemy hero enemy enemy hero enemy hero enemy enemy hero');
  });

  it('预览与实际顺序一致', () => {
    const b = new Battle(unit({ spd: 9 }), unit({ spd: 13, hp: 999, maxHp: 999 }), new SeededRng(5), 100);
    const preview = b.previewOrder(8);
    const actual: string[] = [];
    while (actual.length < 8 && !b.over) actual.push((b.next()[0] as { side: string }).side);
    expect(actual).toEqual(preview.slice(0, actual.length));
  });
});

describe('确定性', () => {
  it('同一个种子打出同一场战斗', () => {
    const run = () => {
      const b = new Battle(unit({ rolandsVoice: true }), unit({ group: 1 }), new SeededRng(99), 100);
      const log: BattleEvent[] = [];
      while (!b.over) log.push(...b.next());
      return log;
    };
    expect(run()).toEqual(run());
  });

  it('预测给出合理的胜率', () => {
    const p = predict(unit({ rolandsVoice: true }), unit({ id: 'slime', atk: parsePool('1d4'), def: parsePool('1d4'), dodge: [], hp: 10, maxHp: 10, spd: 8 }), 100, 300);
    expect(p.winRate).toBe(1);
    expect(p.avgLoss).toBeLessThan(2);
  });
});
