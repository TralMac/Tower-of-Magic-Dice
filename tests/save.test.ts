import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/tower';
import { exportCode, importCode } from '../src/save';

describe('存档码', () => {
  it('导出再导入，状态不变（含中文与随机数状态）', () => {
    const g = Game.create(123);
    g.rng.next();
    g.hero.traits.push('tough');
    const state = g.serialize();
    const code = exportCode(state);
    expect(code.startsWith('TOMD1:')).toBe(true);
    expect(importCode(code)).toEqual(state);
  });

  it('无效的存档码返回 null', () => {
    expect(importCode('hello')).toBeNull();
    expect(importCode('TOMD1:' + btoa('{"v":999}'))).toBeNull();
  });
});
