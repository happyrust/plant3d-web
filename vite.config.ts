import { fileURLToPath, URL } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

import vuetify from 'vite-plugin-vuetify';

const backendPort = process.env.VITE_BACKEND_PORT || '8080';
const backendTarget = `http://localhost:${backendPort}`;

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
    host: true, // 监听 0.0.0.0，允许通过局域网 IP（如 192.168.31.60）访问
    proxy: {
      '/api': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/files': {
        target: backendTarget,
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
        }
      },
    }
  },
});
//plant3d-web/
