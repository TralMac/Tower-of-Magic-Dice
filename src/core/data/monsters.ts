// 怪物数据（GDD 第 11 节 + 10.2 节的掉落初稿）。名字与描述在语言表里：monster.<id>.name / .desc

export interface MonsterDef {
  id: string;
  atk: string;
  def: string;
  dodge: string;
  hp: number;
  spd: number;
  group?: number;
  /** 击杀掉落的魔力结晶 */
  crystals: number;
  /** 打穿玩家防御时扣精力 */
  drainStamina?: number;
  boss?: boolean;
  /** 地图上的配色 */
  color: number;
}

export const MONSTERS: Record<string, MonsterDef> = {
  slime: { id: 'slime', atk: '1d4', def: '1d4', dodge: '', hp: 10, spd: 8, crystals: 2, color: 0x5fbf5a },
  bats: { id: 'bats', atk: '1d4', def: '1d2', dodge: '1d6', hp: 8, spd: 14, group: 1, crystals: 3, drainStamina: 2, color: 0x8a6fbf },
  skeleton: { id: 'skeleton', atk: '2d4', def: '2d6', dodge: '1d2', hp: 16, spd: 9, crystals: 5, color: 0xd8d4c4 },
  goblins: { id: 'goblins', atk: '1d8', def: '1d4', dodge: '1d4', hp: 20, spd: 10, group: 2, crystals: 6, color: 0x9bb83a },
  orc: { id: 'orc', atk: '2d6', def: '2d6', dodge: '1d2', hp: 28, spd: 9, crystals: 10, color: 0xb86a3a },
  captain: { id: 'captain', atk: '2d6', def: '2d6', dodge: '1d2', hp: 45, spd: 10, group: 1, crystals: 40, boss: true, color: 0xe0503a },
};
