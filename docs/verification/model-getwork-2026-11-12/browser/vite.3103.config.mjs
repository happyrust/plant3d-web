/**
 * 「取最新」浏览器验证自己的开发服务器（3103，跑工作树 plant3d-web-getwork）。
 *
 * 工作树的 node_modules 是指向主检出的目录联接，Vite 缺省把预打包依赖缓存写进 `node_modules/.vite`——也就是主检出
 * 那一份。这里把缓存挪到本目录（D 盘、独立的一份），并把主检出的 node_modules 加进 fs.allow（联接解析后的真实路径
 * 在工作树之外）。照 `.scratch/mbd-multitask/page/vite.3102.config.mjs` 写的。
 *
 *   cd <plant3d-web-worktree>
 *   node node_modules/vite/bin/vite.js --config <plant3d-web>\.scratch\incremental-sync\page\vite.3103.config.mjs --host 127.0.0.1 --port 3103 --strictPort
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, loadConfigFromFile, mergeConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.env.PAGE_WORKTREE || '<plant3d-web-worktree>';
const mainNodeModules = path.resolve(here, '..', '..', '..', 'node_modules');

export default defineConfig(async (env) => {
  const loaded = await loadConfigFromFile(env, path.join(root, 'vite.config.ts'), root);
  if (!loaded) throw new Error(`读不到 ${root}/vite.config.ts`);
  return mergeConfig(loaded.config, {
    root,
    cacheDir: path.join(here, '.vite-3103'),
    server: { fs: { allow: [root, mainNodeModules] } },
  });
});
