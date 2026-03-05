import { fileURLToPath, URL } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig, loadEnv } from 'vite';

import vuetify from 'vite-plugin-vuetify';

function inferBackendPortFromApiBase(apiBase: string | undefined): string {
  if (!apiBase) return '';
  try {
    const parsed = new URL(apiBase);
    if (parsed.port) return parsed.port;
    return parsed.protocol === 'https:' ? '443' : '80';
  } catch {
    return '';
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const inferredPort = inferBackendPortFromApiBase(env.VITE_GEN_MODEL_API_BASE_URL);
  const backendPort = env.VITE_BACKEND_PORT || inferredPort || '8080';
  const backendTarget = `http://localhost:${backendPort}`;

  return {
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
      host: true,
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
  };
});
//plant3d-web/
