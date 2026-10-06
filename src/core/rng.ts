// 可设种子的随机数（mulberry32）。状态只有一个 32 位整数，直接写进存档：
// 读档后同样的操作会得到同样的骰子（GDD 1.1 / Q9）。

export interface Rng {
  /** [0, 1) 的随机数 */
  next(): number;
}

export class SeededRng implements Rng {
  state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

/** 不影响存档种子的随机数，用于概率手册的蒙特卡洛预测。 */
export const mathRng: Rng = { next: () => Math.random() };

/** 投一颗 faces 面的骰子，返回 1..faces */
export function rollDie(faces: number, rng: Rng): number {
  return 1 + Math.floor(rng.next() * faces);
}

export function randomSeed(): number {
  return (Math.random() * 4294967296) >>> 0;
}
