import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        // Phaser 单独成包，游戏代码更新时玩家不必重新下载引擎
        manualChunks: { phaser: ['phaser'] },
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
