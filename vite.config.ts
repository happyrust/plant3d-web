import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig, loadEnv } from 'vite';

import vuetify from 'vite-plugin-vuetify';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

function readPkgVersion(): string {
  try {
    const raw = readFileSync(new URL('./package.json', import.meta.url), 'utf-8');
    const pkg = JSON.parse(raw) as { version?: string };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** 与 plant-model-gen build.rs 的 `git rev-parse HEAD` 一致，便于与后端 About 信息对齐 */
function resolveGitFullCommit(): string {
  const fromEnv =
    process.env.GIT_COMMIT_FULL ?? process.env.GITHUB_SHA ?? process.env.GIT_COMMIT;
  const trimmed = fromEnv?.trim() ?? '';
  if (trimmed && /^[0-9a-f]{7,40}$/i.test(trimmed)) return trimmed;
  try {
    return execSync('git rev-parse HEAD', {
      cwd: __dirname,
      encoding: 'utf-8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

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
  const isLikelyMisconfiguredBackendPort = inferredPort === '8080' || inferredPort === '3000' || inferredPort === '3001';
  const backendPort = env.VITE_BACKEND_PORT || (isLikelyMisconfiguredBackendPort ? '3100' : inferredPort || '3100');
  const backendTarget = `http://localhost:${backendPort}`;
  const frontendBuildIso = new Date().toISOString();

  return {
    base: '/',
    define: {
      __FRONTEND_APP_VERSION__: JSON.stringify(readPkgVersion()),
      __FRONTEND_GIT_COMMIT__: JSON.stringify(resolveGitFullCommit()),
      __FRONTEND_BUILD_ISO__: JSON.stringify(frontendBuildIso),
    },
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
          // 强制所有 /files 请求走后端（plant-model-gen）。
          // 说明：此前存在“若 public/files 下存在同名文件则由前端静态服务返回”的旁路逻辑，
          // 会造成数据源不一致（本地文件意外覆盖后端 output 目录）。
          // 按项目约定，/files 始终对应后端 output 根目录。
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
