import { fileURLToPath } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.{test,spec}.{js,ts}'],
    // 全量并行跑时，review / annotation 域几个文件的首条用例（冷加载 store 与组件，单跑 1.1–1.2 s）
    // 会被 5 s 缺省超时误杀成 flaky（2026-09-09 全量 32 failed 里 7 条就是这一类）；
    // 20 s 只兜真挂死，不改任何用例本身。
    testTimeout: 20_000,
    hookTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'src/utils/three/annotation/**/*.ts',
        'src/dimension/**/*.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
