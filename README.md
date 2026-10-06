# 骰子魔塔 · Tower of Magic Dice

魔塔 × 骰子对抗的 HTML5 网页游戏，适配手机端，完全免费。当前是**原型 v0.1：战士篇，3 层**。

## 文档

- 设计文档：[docs/GDD.md](docs/GDD.md)
- 角色设定：[战士 · 凯恩·灰誓（暴怒）](docs/characters/warrior.md)
- 平台与移动端方案：[docs/tech/platform.md](docs/tech/platform.md)
- To Do 清单：[docs/TODO.md](docs/TODO.md)

## 开发

需要 Node.js 20.19+ 或 22.12+。

```bash
npm install
npm run dev        # 本地开发服务器（手机和电脑在同一局域网时可用 --host 在手机上打开）
npm test           # 规则核心的单元测试
npm run typecheck  # TypeScript 类型检查
npm run build      # 构建到 dist/（纯静态文件，可部署到任意静态托管）
npm run preview    # 预览构建结果
npm run sim        # 数值模拟：战士对各怪物、3 层资源账本、首领战
npm run autoplay   # 自动游玩机器人：多个随机种子跑通 3 层，统计通关率
npm run icons      # 重新生成 PWA 图标
```

调试：在地址后面加 `?debug`，可以在浏览器控制台里用 `tomd.game` 查看和修改游戏状态。

## 目录

```
src/core/          规则核心（纯 TypeScript，不依赖渲染）
  dice.ts          骰池、护甲磨损、卸甲减半、骰阶升级
  combat.ts        ATB 战斗、判定、罗兰之声、卸甲、群体瓦解、概率预测
  tower.ts         地图、移动与精力、寻路、营火、昏迷、结晶、事件、战斗结算
  rng.ts           可设种子的随机数（写进存档）
  data/            角色、怪物、地图数据
src/game/          Phaser 地图渲染
src/ui/            DOM 界面：HUD、弹窗、战斗、流程控制
src/i18n/          语言表（简体中文 / 英文）
src/save.ts        存档：IndexedDB + 存档码
public/            PWA：manifest、Service Worker、图标
tests/             单元测试（vitest）
tools/             数值模拟器、自动游玩机器人、图标生成
```
