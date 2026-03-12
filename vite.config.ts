import { existsSync } from 'node:fs';
import { join } from 'node:path';
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

function shouldServeLocalFiles(url: string | undefined): boolean {
  if (!url) return false;

  const pathname = url.split('?')[0] || '';
  const relPath = pathname.replace(/^\/files\/?/, 'files/');
  if (!relPath.startsWith('files/')) return false;

  return existsSync(join(process.cwd(), 'public', decodeURIComponent(relPath)));
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const inferredPort = inferBackendPortFromApiBase(env.VITE_GEN_MODEL_API_BASE_URL);
  const backendPort = env.VITE_BACKEND_PORT || inferredPort || '3100';
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
      port: 3101,
      strictPort: true,
      proxy: {
        '/api': {
          target: backendTarget,
          changeOrigin: true,
        },
        '/files': {
          target: backendTarget,
          changeOrigin: true,
          bypass(req) {
            if (shouldServeLocalFiles(req.url)) {
              return req.url;
            }
            return undefined;
          },
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
