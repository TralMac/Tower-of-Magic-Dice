import { describe, expect, it } from 'vitest';
import { halve, parsePool, poolLevel, showPool, upgrade, wear } from '../src/core/dice';
import { SeededRng } from '../src/core/rng';

describe('骰池', () => {
  it('解析与显示', () => {
    expect(parsePool('2d6')).toEqual([6, 6]);
    expect(parsePool('1d6+1d4')).toEqual([6, 4]);
    expect(parsePool('')).toEqual([]);
    expect(showPool([4, 6])).toBe('d6+d4');
    expect(showPool([6, 6])).toBe('2d6');
    expect(showPool([])).toBe('—');
  });

  it('护甲阶梯：每降 1 级，最小的骰子 −1 面，d1 碎裂（GDD 2.2）', () => {
    const ladder: string[] = [];
    let p = parsePool('2d6');
    while (p.length) {
      ladder.push(showPool(p));
      p = wear(p, 1);
    }
    expect(ladder).toEqual(['2d6', 'd6+d5', 'd6+d4', 'd6+d3', 'd6+d2', 'd6', 'd5', 'd4', 'd3', 'd2']);
  });

  it('防御失败 −2 级：2d6 → d6+d4（你的原始例子）', () => {
    expect(showPool(wear(parsePool('2d6'), 2))).toBe('d6+d4');
  });

  it('卸甲：护甲等级减半（warrior.md 4.2）', () => {
    expect(showPool(halve(parsePool('1d6+1d4')))).toBe('d5');
    expect(showPool(halve(parsePool('2d6')))).toBe('d6');
    expect(showPool(halve(parsePool('1d6+1d2')))).toBe('d4');
    expect(showPool(halve(parsePool('1d5')))).toBe('d2');
  });

  it('骰阶 +1：给最小的骰子 +1 面', () => {
    expect(showPool(upgrade(parsePool('1d6+1d4')))).toBe('d6+d5');
    expect(showPool(upgrade(parsePool('2d6')))).toBe('d7+d6');
    expect(showPool(upgrade([12, 12]))).toBe('2d12+d2');
    expect(poolLevel(upgrade([6, 6]))).toBe(13);
  });
});

describe('随机数', () => {
  it('同一个种子得到同一串结果（读档不能刷骰子）', () => {
    const a = new SeededRng(42);
    const b = new SeededRng(42);
    const xs = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(xs);
    for (const x of xs) expect(x).toBeGreaterThanOrEqual(0);
    for (const x of xs) expect(x).toBeLessThan(1);
  });

  it('状态可以存下来再继续', () => {
    const a = new SeededRng(7);
    a.next();
    const resumed = new SeededRng(a.state);
    expect(resumed.next()).toBe(a.next());
  });
});
