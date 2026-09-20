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

/** 与后端 build.rs 的 `git rev-parse HEAD` 一致，便于与后端 About 信息对齐 */
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

/**
 * gen-model（aios-database）默认监听端口：`/api/v1`（模型树 + 三维模型）、`/api/review` `/api/auth` `/api/users`（校审）、
 * `/files/review_attachments`（附件）全在这一个进程上。旧后端 plant-model-gen `:3100` 2026-09-20 退役。
 */
const GEN_MODEL_DEFAULT_TARGET = 'http://localhost:8022';

/** 代理上游：只接受 http(s) 绝对地址；`/gm` 一类相对写法不能当上游，跳过。 */
function resolveProxyTarget(...candidates: (string | undefined)[]): string {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (!trimmed) continue;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return trimmed.replace(/\/$/, '');
      }
    } catch {
      // 相对前缀或非法 URL：不是上游，看下一个候选
    }
  }
  return GEN_MODEL_DEFAULT_TARGET;
}

function normalizeBasePath(basePath: string | undefined): string {
  const trimmed = basePath?.trim();
  if (!trimmed) return '/';
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // 同源 `/api`（校审 / 认证 / 用户 / 附件）的 dev 代理上游：与 gen-model `/api/v1` 是同一个进程。
  // 优先 VITE_BACKEND_URL / VITE_GEN_MODEL_API_BASE_URL（旧名字，仍认），再取 gen-model 的绝对地址，缺省 :8022。
  const backendTarget = resolveProxyTarget(
    env.VITE_BACKEND_URL,
    env.VITE_API_BASE_URL,
    env.VITE_GEN_MODEL_API_BASE_URL,
    env.VITE_GEN_MODEL_V1_PROXY_TARGET,
    env.VITE_GEN_MODEL_V1_BASE_URL,
  );
  // gen-model `/api/v1`（模型树 + 三维模型）：dev 默认直连 :8022（CORS 已放开）；
  // dev 不想跨域时把 VITE_GEN_MODEL_V1_BASE_URL 写成 `/gm`，请求落到下面的代理。
  // 生产无配置由 apiBase.ts 走空 base（同源 /api/v1），不会使用这条 Vite dev proxy。
  const genModelV1Target = resolveProxyTarget(
    env.VITE_GEN_MODEL_V1_PROXY_TARGET,
    env.VITE_GEN_MODEL_V1_BASE_URL,
  );
  // 使用北京时间构建前端
  const now = new Date();
  const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const frontendBuildIso = beijingTime.toISOString();
  const basePath = normalizeBasePath(env.VITE_BASE_PATH);

  return {
    base: basePath,
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
        // 校审附件下载（gen-model `PLANT_ASSET_ROOT`）；旧后端的 `/files/output` parquet 与 `/files/meshes` GLB 已随 legacy 退役。
        '/files/review_attachments': {
          target: backendTarget,
          changeOrigin: true,
        },
        // gen-model /api/v1 同源代理：`/gm/api/v1/tree/roots` → `${genModelV1Target}/api/v1/tree/roots`。
        '/gm': {
          target: genModelV1Target,
          changeOrigin: true,
          ws: true,
          rewrite: (path) => path.replace(/^\/gm(?=\/|$)/, ''),
        },
      },
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
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
