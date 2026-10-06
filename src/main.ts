import Phaser from 'phaser';
import './styles.css';
import { Game } from './core/tower';
import { MapScene } from './game/MapScene';
import { lang, setLang, t } from './i18n';
import { readSave } from './save';
import { Controller } from './ui/controller';

async function boot(): Promise<void> {
  setLang(lang());
  document.title = `${t('app.title')} · ${t('app.subtitle')}`;

  // 继续上次的进度：继续存档 → 手动存档 → 自动存档 → 新游戏
  const saved = (await readSave('resume')) ?? (await readSave('quick')) ?? (await readSave('auto'));
  const game = saved && saved.status === 'playing' ? new Game(saved) : Game.create();
  const controller = new Controller(game);

  const parent = document.getElementById('map')!;
  const scene = new MapScene(
    () => controller.game,
    (p) => controller.tap(p),
  );
  const phaser = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#14161f',
    pixelArt: true,
    scale: { mode: Phaser.Scale.NONE, width: 352, height: 352 },
    scene,
    banner: false,
    audio: { noAudio: true },
  });

  // 高清屏：画布按设备像素比渲染，再用 CSS 缩回容器大小，保证像素和文字清晰
  const fit = () => {
    const rect = parent.getBoundingClientRect();
    const size = Math.max(160, Math.floor(Math.min(rect.width, rect.height)));
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    phaser.scale.resize(Math.round(size * dpr), Math.round(size * dpr));
    const canvas = phaser.canvas;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    phaser.scale.updateBounds();
  };
  phaser.events.once(Phaser.Core.Events.READY, () => {
    fit();
    controller.attach(scene);
  });
  new ResizeObserver(() => fit()).observe(parent);

  // 调试：?debug 时把控制器挂到 window 上，方便自动化测试
  if (new URLSearchParams(location.search).has('debug')) (window as unknown as { tomd: Controller }).tomd = controller;

  // 键盘：方向键 / WASD
  const keys: Record<string, [number, number]> = {
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    w: [0, -1],
    s: [0, 1],
    a: [-1, 0],
    d: [1, 0],
  };
  window.addEventListener('keydown', (e) => {
    const k = keys[e.key] ?? keys[e.key.toLowerCase()];
    if (!k || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
    e.preventDefault();
    controller.move(k[0], k[1]);
  });

  // 切到后台：立刻存档（手机浏览器随时可能回收后台标签页）
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') controller.persistResume(true);
  });

  // PWA：只在正式构建中注册 Service Worker
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => undefined);
    });
  }
}

void boot();
