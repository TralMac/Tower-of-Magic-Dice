// 骰池：用「每颗骰子的面数」数组表示，如 2d6 = [6, 6]，d6+d4 = [6, 4]。
// 护甲等级 = 所有防御骰面数之和（GDD 2.2）。

import { rollDie, type Rng } from './rng';

export type Pool = number[];

/** 单颗骰子的面数上限（原型规则，见 TODO：骰阶上限待定） */
export const MAX_FACES = 12;

export function parsePool(s: string): Pool {
  if (!s) return [];
  return s.split('+').flatMap((part) => {
    const [n, f] = part.trim().split('d').map(Number);
    return Array<number>(n || 1).fill(f);
  });
}

/** 按面数从大到小显示，如 [4, 6] → "d6+d4"，[6, 6] → "2d6" */
export function showPool(pool: Pool): string {
  if (!pool.length) return '—';
  const counts = new Map<number, number>();
  for (const f of pool) counts.set(f, (counts.get(f) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([f, n]) => `${n > 1 ? n : ''}d${f}`)
    .join('+');
}

export const sum = (xs: number[]): number => xs.reduce((s, x) => s + x, 0);

export function poolLevel(pool: Pool): number {
  return sum(pool);
}

export function rollFaces(pool: Pool, rng: Rng): number[] {
  return pool.map((f) => rollDie(f, rng));
}

const sortedDesc = (pool: Pool): Pool => [...pool].sort((a, b) => b - a);

/** 护甲磨损：每降 1 级，面数最小的骰子 −1 面；降到 d1 时碎裂移除。 */
export function wear(pool: Pool, levels: number): Pool {
  let p = sortedDesc(pool);
  for (let i = 0; i < levels && p.length; i++) {
    p[p.length - 1] -= 1;
    if (p[p.length - 1] <= 1) p.pop();
    p = sortedDesc(p);
  }
  return p;
}

/** 护甲减半：等级降到 floor(当前等级 / 2)，按磨损规则逐级扣除（战士「卸甲」）。 */
export function halve(pool: Pool): Pool {
  const target = Math.floor(poolLevel(pool) / 2);
  let p = sortedDesc(pool);
  while (p.length && poolLevel(p) > target) p = wear(p, 1);
  return p;
}

/** 骰阶 +1：面数最小、且未到上限的骰子 +1 面；全部到上限时追加一颗 d2。 */
export function upgrade(pool: Pool): Pool {
  const p = sortedDesc(pool);
  for (let i = p.length - 1; i >= 0; i--) {
    if (p[i] < MAX_FACES) {
      p[i] += 1;
      return sortedDesc(p);
    }
  }
  return [...p, 2];
}
