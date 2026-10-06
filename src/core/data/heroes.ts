// 角色数据（GDD 6.2 / characters/warrior.md）。原型阶段只有战士。

export interface HeroDef {
  id: string;
  atk: string;
  def: string;
  dodge: string;
  maxHp: number;
  spd: number;
  maxStamina: number;
  rolandsVoice?: boolean;
  unarmor?: boolean;
}

export const HEROES: Record<string, HeroDef> = {
  warrior: {
    id: 'warrior',
    atk: '2d6',
    def: '1d6+1d4',
    dodge: '1d4',
    maxHp: 50,
    spd: 10,
    maxStamina: 120,
    rolandsVoice: true,
    unarmor: true,
  },
};
