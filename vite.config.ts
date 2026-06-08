import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

import vue from '@vitejs/plugin-vue';
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite';

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

function normalizeBasePath(basePath: string | undefined): string {
  const trimmed = basePath?.trim();
  if (!trimmed) return '/';
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`;
}

const DUCKDB_ASSET_FILES = [
  'duckdb-browser-mvp.worker.js',
  'duckdb-browser-eh.worker.js',
  'duckdb-browser-coi.worker.js',
  'duckdb-browser-coi.pthread.worker.js',
  'duckdb-mvp.wasm',
  'duckdb-eh.wasm',
  'duckdb-coi.wasm',
] as const;

const DUCKDB_EXTENSION_ASSET_FILES = [
  'v1.5.3/wasm_eh/parquet.duckdb_extension.wasm',
  'v1.5.3/wasm_mvp/parquet.duckdb_extension.wasm',
  'v1.5.3/wasm_threads/parquet.duckdb_extension.wasm',
] as const;

function duckDBAssetSourceDir(): string {
  return fileURLToPath(
    new URL('./node_modules/@duckdb/duckdb-wasm/dist/', import.meta.url)
  );
}

function duckDBExtensionAssetSourceDir(): string {
  return resolve(__dirname, 'public/duckdb/extensions');
}

function resolveDuckDBAssetVersion(): string {
  const sourceDir = duckDBAssetSourceDir();
  const extensionSourceDir = duckDBExtensionAssetSourceDir();
  const hash = createHash('sha256');
  for (const fileName of DUCKDB_ASSET_FILES) {
    const source = resolve(sourceDir, fileName);
    if (!existsSync(source)) {
      throw new Error(`DuckDB WASM asset not found: ${source}`);
    }
    hash.update(fileName);
    hash.update(readFileSync(source));
  }
  for (const fileName of DUCKDB_EXTENSION_ASSET_FILES) {
    const source = resolve(extensionSourceDir, fileName);
    if (!existsSync(source)) {
      throw new Error(`DuckDB WASM extension asset not found: ${source}`);
    }
    hash.update(`extensions/${fileName}`);
    hash.update(readFileSync(source));
  }
  return hash.digest('hex').slice(0, 16);
}

function copyDuckDBWasmAssetsPlugin(): Plugin {
  let outDir = 'dist';
  const sourceDir = duckDBAssetSourceDir();
  const extensionSourceDir = duckDBExtensionAssetSourceDir();

  return {
    name: 'copy-duckdb-wasm-assets',
    configResolved(config) {
      outDir = config.build.outDir || 'dist';
    },
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/duckdb', (req, res, next) => {
        const fileName = decodeURIComponent((req.url ?? '').split('?', 1)[0]).replace(/^\/+/, '');
        let source: string | null = null;
        if (DUCKDB_ASSET_FILES.includes(fileName as (typeof DUCKDB_ASSET_FILES)[number])) {
          source = resolve(sourceDir, fileName);
        } else if (fileName.startsWith('extensions/')) {
          const extensionFileName = fileName.slice('extensions/'.length);
          if (DUCKDB_EXTENSION_ASSET_FILES.includes(extensionFileName as (typeof DUCKDB_EXTENSION_ASSET_FILES)[number])) {
            source = resolve(extensionSourceDir, extensionFileName);
          }
        }

        if (!source) {
          next();
          return;
        }

        res.statusCode = 200;
        res.setHeader(
          'Content-Type',
          fileName.endsWith('.wasm') ? 'application/wasm' : 'text/javascript; charset=utf-8'
        );
        res.setHeader('Cache-Control', 'no-cache');
        res.end(readFileSync(source));
      });
    },
    closeBundle() {
      const targetDir = resolve(__dirname, outDir, 'duckdb');
      mkdirSync(targetDir, { recursive: true });

      for (const fileName of DUCKDB_ASSET_FILES) {
        const source = resolve(sourceDir, fileName);
        copyFileSync(source, resolve(targetDir, fileName));
      }

      for (const fileName of DUCKDB_EXTENSION_ASSET_FILES) {
        const source = resolve(extensionSourceDir, fileName);
        const target = resolve(targetDir, 'extensions', fileName);
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(source, target);
      }
    },
  };
}


// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const inferredPort = inferBackendPortFromApiBase(env.VITE_GEN_MODEL_API_BASE_URL);
  const isLikelyMisconfiguredBackendPort = inferredPort === '8080' || inferredPort === '3000' || inferredPort === '3001';
  const backendPort = env.VITE_BACKEND_PORT || (isLikelyMisconfiguredBackendPort ? '3100' : inferredPort || '3100');
  const backendTarget = `http://localhost:${backendPort}`;
  // 使用北京时间构建前端
  const now = new Date();
  const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const frontendBuildIso = beijingTime.toISOString();
  const basePath = normalizeBasePath(env.VITE_BASE_PATH);
  const duckDBAssetVersion = resolveDuckDBAssetVersion();

  return {
    base: basePath,
    define: {
      __FRONTEND_APP_VERSION__: JSON.stringify(readPkgVersion()),
      __FRONTEND_GIT_COMMIT__: JSON.stringify(resolveGitFullCommit()),
      __FRONTEND_BUILD_ISO__: JSON.stringify(frontendBuildIso),
      __DUCKDB_ASSET_VERSION__: JSON.stringify(duckDBAssetVersion),
    },
    plugins: [
      vue({
        template: { transformAssetUrls: false }
      }),
      vuetify({
        autoImport: true,
      }),
      copyDuckDBWasmAssetsPlugin(),
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
