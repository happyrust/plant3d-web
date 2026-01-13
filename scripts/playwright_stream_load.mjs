import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';

import { chromium } from 'playwright';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findFreePort(preferredPort) {
  async function tryListen(port, host) {
    return await new Promise((resolve) => {
      const server = net.createServer();
      server.unref();
      server.on('error', (err) => resolve({ ok: false, code: err?.code }));
      server.listen(port, host, () => {
        const address = server.address();
        const actualPort = typeof address === 'object' && address ? address.port : null;
        server.close(() => resolve({ ok: true, port: actualPort }));
      });
    });
  }

  async function tryCandidate(port) {
    const v4 = await tryListen(port, '127.0.0.1');
    if (!v4.ok) return null;

    const v6 = await tryListen(port, '::1');
    if (!v6.ok && v6.code !== 'EADDRNOTAVAIL') return null;

    return v4.port;
  }

  if (Number.isFinite(preferredPort) && preferredPort > 0) {
    const ok = await tryCandidate(preferredPort);
    if (ok) return ok;
  }

  const randomV4 = await tryListen(0, '127.0.0.1');
  if (!randomV4.ok) throw new Error('无法分配可用端口');
  const random = await tryCandidate(randomV4.port);
  if (!random) throw new Error('无法分配可用端口');
  return random;
}

async function waitForHttpOk(url, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const resp = await fetch(url);
      if (resp.ok) return;
    } catch {
      // ignore
    }
    await sleep(500);
  }
  throw new Error(`Timeout waiting for ${url}`);
}

function spawnLogged(command, args, options) {
  const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => process.stdout.write(`[${command}] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[${command}] ${d}`));
  return child;
}

function killProcess(child) {
  if (!child || child.killed) return;
  try {
    child.kill('SIGTERM');
  } catch {
    // ignore
  }
}

const refno = process.argv[2] || '24383_73962';
const port = await findFreePort(Number(process.env.PORT || 8080));
const vitePort = await findFreePort(Number(process.env.VITE_PORT || 5173));
const baseUrl = `http://127.0.0.1:${vitePort}`;
const backendHealthUrl = `http://127.0.0.1:${port}/api/health`;

const artifactsDir = path.resolve(process.cwd(), 'artifacts');
mkdirSync(artifactsDir, { recursive: true });

// 1) 启动后端（需要你已经在 gen-model-fork 编译过 web_server）
const backendCwd = path.resolve(process.cwd(), '..', 'gen-model-fork');
const backendBin = path.resolve(backendCwd, 'target', 'debug', 'web_server');
const backend = spawnLogged(
  backendBin,
  ['--config', process.env.DB_OPTION_FILE || 'DbOption-1112'],
  { cwd: backendCwd, env: { ...process.env, PORT: String(port) } }
);

// 2) 启动前端 Vite
const vite = spawnLogged(
  'pnpm',
  ['exec', 'vite', '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'],
  { cwd: process.cwd(), env: { ...process.env, VITE_BACKEND_PORT: String(port) } }
);

let browser;
try {
  await waitForHttpOk(backendHealthUrl, 120_000);
  await waitForHttpOk(baseUrl, 120_000);

  browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=swiftshader', '--enable-webgl'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[StreamGenerate]') || text.includes('[Surreal→Xeokit]') || text.includes('[ViewerPanel]')) {
      process.stdout.write(`[browser] ${text}\n`);
    }
  });
  page.on('pageerror', (err) => process.stderr.write(`[pageerror] ${err}\n`));

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

  // 等待 Viewer 初始化并暴露到 window（DEV 模式下 ViewerPanel 会设置 window.__xeokitViewer）
  await page.waitForFunction(() => !!window.__xeokitViewer?.scene, null, { timeout: 120_000 });

  // 触发按需加载
  await page.evaluate((id) => {
    window.dispatchEvent(
      new CustomEvent('showModelByRefnos', {
        detail: { refnos: [id], regenModel: false },
      })
    );
  }, refno);

  // 等待目标 refno 出现在 scene.objects 中
  await page.waitForFunction(
    (id) => !!window.__xeokitViewer?.scene?.objects?.[id],
    refno,
    { timeout: 300_000 }
  );

  const pngPath = path.join(artifactsDir, `${refno}.png`);
  await page.screenshot({ path: pngPath });
  process.stdout.write(`OK: loaded ${refno}, screenshot=${pngPath}\n`);
} finally {
  if (browser) {
    try {
      await browser.close();
    } catch {
      // ignore
    }
  }
  killProcess(vite);
  killProcess(backend);
}
