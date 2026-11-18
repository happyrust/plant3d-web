/**
 * 增量 PML 网页验收用的页面服务：把这棵工作树的页面代码起成一个只听本机回环的开发服务，页面的后端请求指到隔离后端。
 * 从 11-17 回归用的那份启动脚本整理过来，地址和目录改成参数。
 *
 * - 页面代码取自这棵工作树（只读使用，不往里写文件）；依赖缓存放 `--cache-dir`，不碰 `node_modules/.vite`
 *   （这棵树的 node_modules 可能是指向别的目录的联接，那边的缓存别的服务在用）；
 * - 只听 127.0.0.1，端口被占就退出，不换端口；
 * - 后端地址必须是本机回环、端口不能是 8022 / 8009；页面自己发的 /api/v1 请求和同源 /api 代理的上游都指它；
 * - 听端口之前把生效的配置核一遍：代理的上游有一个不是隔离后端、或者给页面的地址里有现网端口，就不起；
 * - 这个服务自己不拦请求——拦在浏览器那一层（`lib/page.mjs` 的 `createGuardedContext`）。
 *
 * 用法：node e2e/increment-pml/serve.mjs --backend http://127.0.0.1:9199 --cache-dir <目录> [--port 3104] [--pid-file <文件>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { loopbackOrigin } from './lib/backend.mjs';
import { LIVE_PORTS } from './lib/judge.mjs';

const PORT_MIN = 3104;
const PORT_MAX = 3109;

function refuse(message) {
  console.error(`[increment-pml-page] ${message}`);
  process.exit(2);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({
  options: {
    root: { type: 'string', default: path.resolve(here, '..', '..') },
    port: { type: 'string', default: String(PORT_MIN) },
    backend: { type: 'string' },
    'cache-dir': { type: 'string' },
    'pid-file': { type: 'string' },
  },
});

const root = path.resolve(values.root);
if (!fs.existsSync(path.join(root, 'vite.config.ts'))) refuse(`--root 不是页面的工作树：${root}`);
const port = Number(values.port);
if (!Number.isInteger(port) || port < PORT_MIN || port > PORT_MAX) refuse(`--port 要在 ${PORT_MIN}–${PORT_MAX} 之间`);
if (!values.backend) refuse('没给 --backend（隔离后端的地址）');
let backend;
try {
  backend = loopbackOrigin(values.backend, '--backend');
} catch (error) {
  refuse(error.message);
}
if (new URL(backend).port === String(port)) refuse('--backend 和页面服务是同一个端口');
if (!values['cache-dir']) refuse('没给 --cache-dir（依赖缓存放哪）');
const cacheDir = path.resolve(values['cache-dir']);
const nodeModules = path.join(root, 'node_modules');
const realNodeModules = fs.realpathSync(nodeModules);
const inside = (dir, parent) => !path.relative(parent, dir).startsWith('..') && !path.isAbsolute(path.relative(parent, dir));
if (inside(cacheDir, nodeModules) || inside(cacheDir, realNodeModules)) refuse(`--cache-dir 不能放在 node_modules 里：${cacheDir}`);
fs.mkdirSync(cacheDir, { recursive: true });

// 工作树自己的 vite.config.ts 从环境变量定代理上游和给页面的后端地址：这里给定，不靠机器上已有的设置
for (const name of ['VITE_API_BASE_URL', 'VITE_GEN_MODEL_API_BASE_URL', 'VITE_BASE_PATH', 'VITE_GEN_MODEL_V1_PROXY_TARGET']) delete process.env[name];
process.env.VITE_BACKEND_URL = backend;
process.env.VITE_GEN_MODEL_V1_BASE_URL = backend;
process.chdir(root);

const vite = await import(pathToFileURL(path.join(nodeModules, 'vite', 'dist', 'node', 'index.js')).href);
const server = await vite.createServer({
  root,
  configFile: path.join(root, 'vite.config.ts'),
  // 用 runner 读配置：缺省的读法会往 node_modules 里写临时文件
  configLoader: 'runner',
  cacheDir,
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port,
    strictPort: true,
    open: false,
    fs: { allow: [...new Set([root, realNodeModules, cacheDir])] },
  },
});

// 听端口之前核对生效的配置：同源代理是这个服务自己转发的，浏览器那一层的闸门看不见它发到哪——上游只能是隔离后端；
// 给页面的地址里也不能有现网端口（工作树里要是放了 .env 文件，可能另有设置）。
const resolved = server.config;
const parse = (value) => {
  try {
    return new URL(String(value).trim());
  } catch {
    return null;
  }
};
const wrong = [];
for (const [prefix, item] of Object.entries(resolved.server.proxy ?? {})) {
  const target = typeof item === 'string' ? item : item?.target;
  if (parse(target)?.origin !== backend) wrong.push(`代理 ${prefix} 的上游是 ${target}`);
}
for (const [name, value] of Object.entries(resolved.env ?? {})) {
  const url = typeof value === 'string' && /^[a-z][a-z0-9+.-]*:\/\//i.test(value.trim()) ? parse(value) : null;
  if (url && LIVE_PORTS.includes(Number(url.port))) wrong.push(`给页面的 ${name} 指到现网端口 ${url.port}`);
}
if (wrong.length > 0) {
  await server.close();
  refuse(`生效的配置没有全指到隔离后端 ${backend}，不起：${wrong.join('；')}`);
}
await server.listen();

const proxies = Object.entries(resolved.server.proxy ?? {})
  .map(([prefix, item]) => `${prefix} -> ${typeof item === 'string' ? item : item.target}`);
console.log(`[increment-pml-page] 页面服务已起 pid=${process.pid}`);
console.log(`[increment-pml-page]   地址 http://127.0.0.1:${port}/`);
console.log(`[increment-pml-page]   代码 ${root}`);
console.log(`[increment-pml-page]   后端 ${backend}（页面直连）`);
console.log(`[increment-pml-page]   缓存 ${resolved.cacheDir}`);
console.log(`[increment-pml-page]   监听 ${JSON.stringify(server.httpServer?.address())}`);
console.log(`[increment-pml-page]   代理 ${proxies.join('；')}`);
console.log(`[increment-pml-page]   给页面的后端地址 VITE_GEN_MODEL_V1_BASE_URL=${resolved.env?.VITE_GEN_MODEL_V1_BASE_URL ?? '（没读到）'}`);
if (values['pid-file']) {
  fs.mkdirSync(path.dirname(path.resolve(values['pid-file'])), { recursive: true });
  fs.writeFileSync(path.resolve(values['pid-file']), String(process.pid), 'utf8');
}

const stop = async () => {
  try {
    await server.close();
  } finally {
    process.exit(0);
  }
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
