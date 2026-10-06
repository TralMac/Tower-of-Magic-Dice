// 地图渲染（Phaser 3）。原型阶段用程序绘制的占位图形，之后换成像素美术（platform.md 3.1）。

import Phaser from 'phaser';
import { MONSTER_TILES } from '../core/data/floors';
import { MONSTERS } from '../core/data/monsters';
import type { Game, Pos } from '../core/tower';
import { lang, td } from '../i18n';

const C = {
  floor: 0x1d2230,
  floorLine: 0x242a3b,
  wall: 0x3a3f55,
  wallLine: 0x2c3044,
  yellow: 0xe8c547,
  blue: 0x5b8ee8,
  red: 0xd9534f,
  potion: 0xe06a6a,
  gemAtk: 0xe0503a,
  gemDef: 0x4f86e0,
  wood: 0x8a5a2b,
  fire: 0xf08a24,
  fireOut: 0x555a66,
  gold: 0xe0a64a,
  altar: 0x9b6fd6,
  teal: 0x3fb6a8,
  sign: 0x9c7b52,
  ember: 0xd9682b,
  hero: 0xcfd6e6,
  heroBand: 0xb03a3a,
  path: 0xe0a64a,
  pathBad: 0xe0503a,
};

export interface MapView {
  render(): void;
  showPath(path: Pos[] | null, faintAt: number | null): void;
}

export class MapScene extends Phaser.Scene implements MapView {
  private gfx!: Phaser.GameObjects.Graphics;
  private overlay!: Phaser.GameObjects.Graphics;
  private labels: Phaser.GameObjects.Text[] = [];
  private path: Pos[] | null = null;
  private faintAt: number | null = null;
  private tile = 32;
  private ox = 0;
  private oy = 0;

  constructor(
    private readonly getGame: () => Game,
    private readonly onTap: (p: Pos) => void,
  ) {
    super('map');
  }

  create(): void {
    this.gfx = this.add.graphics();
    this.overlay = this.add.graphics();
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const x = Math.floor((p.x - this.ox) / this.tile);
      const y = Math.floor((p.y - this.oy) / this.tile);
      const g = this.getGame();
      if (x >= 0 && y >= 0 && x < g.width && y < g.height) this.onTap({ x, y });
    });
    this.scale.on('resize', () => this.render());
    this.render();
  }

  showPath(path: Pos[] | null, faintAt: number | null): void {
    this.path = path;
    this.faintAt = faintAt;
    this.drawOverlay();
  }

  render(): void {
    if (!this.gfx) return;
    const g = this.getGame();
    const w = this.scale.width;
    const h = this.scale.height;
    this.tile = Math.max(8, Math.floor(Math.min(w / g.width, h / g.height)));
    this.ox = Math.floor((w - this.tile * g.width) / 2);
    this.oy = Math.floor((h - this.tile * g.height) / 2);

    this.gfx.clear();
    for (const l of this.labels) l.destroy();
    this.labels = [];

    for (let y = 0; y < g.height; y++) {
      for (let x = 0; x < g.width; x++) this.drawTile(g, { x, y });
    }
    this.drawHero(g.state.pos);
    this.drawOverlay();
  }

  private px(p: Pos) {
    return { x: this.ox + p.x * this.tile, y: this.oy + p.y * this.tile, s: this.tile };
  }

  private label(text: string, p: Pos, color = '#14161f', scale = 0.42) {
    const { x, y, s } = this.px(p);
    const t = this.add
      .text(x + s / 2, y + s / 2, text, {
        fontFamily: 'system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
        fontSize: `${Math.round(s * scale)}px`,
        color,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.labels.push(t);
  }

  private drawTile(g: Game, p: Pos): void {
    const ch = g.tile(p);
    const { x, y, s } = this.px(p);
    const gfx = this.gfx;
    const m = Math.max(1, Math.round(s * 0.08));

    if (ch === '#') {
      gfx.fillStyle(C.wall).fillRect(x, y, s, s);
      gfx.lineStyle(1, C.wallLine);
      gfx.strokeRect(x + 0.5, y + 0.5, s - 1, s / 2);
      gfx.strokeRect(x + s / 2 + 0.5, y + s / 2 + 0.5, s / 2 - 1, s / 2 - 1);
      return;
    }
    gfx.fillStyle(C.floor).fillRect(x, y, s, s);
    gfx.lineStyle(1, C.floorLine).strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);

    const cx = x + s / 2;
    const cy = y + s / 2;
    const monsterId = MONSTER_TILES[ch];
    if (monsterId) {
      const mdef = MONSTERS[monsterId];
      const r = s * (mdef.boss ? 0.46 : 0.38);
      gfx.fillStyle(mdef.color).fillCircle(cx, cy, r);
      if (mdef.boss) gfx.lineStyle(2, C.red).strokeCircle(cx, cy, r);
      if (mdef.group) {
        gfx.fillStyle(mdef.color).fillCircle(x + s * 0.8, y + s * 0.22, s * 0.14);
        if (mdef.group > 1) gfx.fillStyle(mdef.color).fillCircle(x + s * 0.2, y + s * 0.22, s * 0.14);
      }
      this.label(td(`monster.${monsterId}.short`), p, '#14161f', lang() === 'en' ? 0.34 : 0.42);
      return;
    }

    switch (ch) {
      case '<':
      case '>': {
        gfx.fillStyle(0x2f3550).fillRect(x + m, y + m, s - 2 * m, s - 2 * m);
        for (let i = 0; i < 3; i++) {
          gfx.fillStyle(0x4a5274).fillRect(x + m * 2, y + m * 2 + i * ((s - 4 * m) / 3), s - 4 * m, (s - 4 * m) / 6);
        }
        this.label(ch === '>' ? '▲' : '▼', p, '#e0a64a', 0.4);
        break;
      }
      case 'Y':
      case 'U': {
        const col = ch === 'Y' ? C.yellow : C.blue;
        gfx.fillStyle(col).fillRect(x + m, y + m, s - 2 * m, s - 2 * m);
        gfx.lineStyle(2, 0x14161f).strokeRect(x + m * 2, y + m * 2, s - 4 * m, s - 4 * m);
        gfx.fillStyle(0x14161f).fillCircle(x + s * 0.7, cy, s * 0.06);
        break;
      }
      case 'y':
      case 'u': {
        const col = ch === 'y' ? C.yellow : C.blue;
        gfx.fillStyle(col).fillCircle(x + s * 0.34, cy, s * 0.15);
        gfx.fillStyle(col).fillRect(x + s * 0.4, cy - s * 0.05, s * 0.36, s * 0.1);
        gfx.fillStyle(col).fillRect(x + s * 0.66, cy, s * 0.07, s * 0.14);
        gfx.fillStyle(C.floor).fillCircle(x + s * 0.34, cy, s * 0.06);
        break;
      }
      case 'h':
      case 'H': {
        const r = ch === 'H' ? 0.27 : 0.19;
        gfx.fillStyle(C.potion).fillCircle(cx, cy + s * 0.06, s * r);
        gfx.fillStyle(0xd8d4c4).fillRect(cx - s * 0.06, cy - s * (r + 0.12), s * 0.12, s * 0.14);
        break;
      }
      case 'a':
      case 'd': {
        const col = ch === 'a' ? C.gemAtk : C.gemDef;
        gfx.fillStyle(col).fillTriangle(cx, y + s * 0.15, x + s * 0.8, cy, cx, y + s * 0.85);
        gfx.fillStyle(col).fillTriangle(cx, y + s * 0.15, x + s * 0.2, cy, cx, y + s * 0.85);
        gfx.fillStyle(0xffffff, 0.35).fillTriangle(cx, y + s * 0.15, x + s * 0.2, cy, cx, cy);
        break;
      }
      case 'w': {
        gfx.fillStyle(C.wood).fillRect(x + s * 0.2, cy - s * 0.12, s * 0.6, s * 0.1);
        gfx.fillStyle(C.wood).fillRect(x + s * 0.2, cy + s * 0.04, s * 0.6, s * 0.1);
        break;
      }
      case 'c': {
        const lit = g.campfireUses(p) > 0;
        gfx.fillStyle(C.wood).fillRect(x + s * 0.2, y + s * 0.72, s * 0.6, s * 0.1);
        gfx.fillStyle(lit ? C.fire : C.fireOut).fillTriangle(cx, y + s * 0.15, x + s * 0.25, y + s * 0.72, x + s * 0.75, y + s * 0.72);
        if (lit) gfx.fillStyle(C.yellow).fillTriangle(cx, y + s * 0.38, x + s * 0.38, y + s * 0.72, x + s * 0.62, y + s * 0.72);
        this.label(String(g.campfireUses(p)), { x: p.x, y: p.y }, '#ffffff', 0.26);
        this.labels[this.labels.length - 1].setPosition(x + s * 0.85, y + s * 0.18);
        break;
      }
      case '$':
        gfx.fillStyle(C.gold).fillCircle(cx, cy, s * 0.36);
        this.label('$', p, '#14161f', 0.48);
        break;
      case 'A':
        gfx.fillStyle(C.altar).fillRect(x + s * 0.28, y + s * 0.3, s * 0.44, s * 0.55);
        gfx.fillStyle(C.altar).fillRect(x + s * 0.18, y + s * 0.18, s * 0.64, s * 0.14);
        gfx.fillStyle(0xffffff, 0.6).fillCircle(cx, y + s * 0.12, s * 0.07);
        break;
      case 'x':
        gfx.fillStyle(C.teal).fillCircle(cx, cy, s * 0.36);
        this.label('⇄', p, '#14161f', 0.5);
        break;
      case 'n':
        gfx.fillStyle(C.sign).fillRect(x + s * 0.18, y + s * 0.2, s * 0.64, s * 0.4);
        gfx.fillStyle(C.sign).fillRect(cx - s * 0.04, y + s * 0.6, s * 0.08, s * 0.28);
        gfx.fillStyle(0x14161f).fillRect(x + s * 0.26, y + s * 0.32, s * 0.48, s * 0.04);
        gfx.fillStyle(0x14161f).fillRect(x + s * 0.26, y + s * 0.44, s * 0.36, s * 0.04);
        break;
      case 'e':
        gfx.fillStyle(C.ember).fillCircle(x + s * 0.4, y + s * 0.62, s * 0.1);
        gfx.fillStyle(C.ember).fillCircle(x + s * 0.6, y + s * 0.66, s * 0.08);
        gfx.fillStyle(C.yellow).fillCircle(x + s * 0.5, y + s * 0.5, s * 0.06);
        this.label('?', p, '#e8c547', 0.34);
        this.labels[this.labels.length - 1].setPosition(cx, y + s * 0.25);
        break;
    }
  }

  private drawHero(p: Pos): void {
    const { x, y, s } = this.px(p);
    const cx = x + s / 2;
    const cy = y + s / 2;
    this.gfx.fillStyle(0x000000, 0.35).fillEllipse(cx, y + s * 0.86, s * 0.6, s * 0.16);
    this.gfx.fillStyle(C.hero).fillCircle(cx, cy, s * 0.36);
    this.gfx.fillStyle(C.heroBand).fillRect(cx - s * 0.36, cy + s * 0.04, s * 0.72, s * 0.1);
    this.label(lang() === 'en' ? 'K' : '凯', p, '#14161f', 0.36);
    this.labels[this.labels.length - 1].setPosition(cx, cy - s * 0.08);
  }

  private drawOverlay(): void {
    if (!this.overlay) return;
    this.overlay.clear();
    if (!this.path) return;
    this.path.forEach((p, i) => {
      const { x, y, s } = this.px(p);
      const bad = this.faintAt !== null && i + 1 >= this.faintAt;
      this.overlay.fillStyle(bad ? C.pathBad : C.path, i === this.path!.length - 1 ? 0.45 : 0.25);
      this.overlay.fillRect(x + 2, y + 2, s - 4, s - 4);
    });
  }
}
