import { fileURLToPath, URL } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

import vuetify from 'vite-plugin-vuetify';

// https://vitejs.dev/config/
export default defineConfig({
  base: '/',
  plugins: [
    vue({
      template: { transformAssetUrls: false }
    }),
    vuetify({
      autoImport: true,
    }),
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/files': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  // 配置 parquet-wasm WASM 加载
  optimizeDeps: {
    exclude: ['parquet-wasm'],
  },
  assetsInclude: ['**/*.wasm'],
  build: {
    // Rollup Options
    // https://vitejs.dev/config/build-options.html#build-rollupoptions
    rollupOptions: {
      output: {
        manualChunks: {
          ui: [
            'vue',
            'vuetify'
          ],
          xeokit: [
            '@xeokit/xeokit-sdk',
          ],
        }
      },
    }
  },
});
//plant3d-web/
