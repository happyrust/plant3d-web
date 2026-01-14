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

const refnos = (process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['24383_73962'])
  .map((r) => String(r || '').trim())
  .filter(Boolean);
const minObjects = Number(process.env.MIN_OBJECTS || '0');
const port = await findFreePort(Number(process.env.PORT || 8080));
const vitePort = await findFreePort(Number(process.env.VITE_PORT || 5173));
const baseUrl = `http://127.0.0.1:${vitePort}`;
const backendHealthUrl = `http://127.0.0.1:${port}/api/health`;

const artifactsDir = path.resolve(process.cwd(), 'artifacts');
mkdirSync(artifactsDir, { recursive: true });

// 1) 启动后端（需要你已经在 gen-model-fork 编译过 web_server）
const backendCwd = path.resolve(process.cwd(), '..', 'gen-model-fork');
const backendBin = path.resolve(backendCwd, 'target', 'debug', 'web_server');
let backendConfig = String(process.env.DB_OPTION_FILE || 'DbOption').trim();
// web_server 的 --config 参数要求“无扩展名”（会自动补 .toml）
if (backendConfig.toLowerCase().endsWith('.toml')) {
  backendConfig = backendConfig.slice(0, -5);
}
const backend = spawnLogged(
  backendBin,
  ['--config', backendConfig],
  { cwd: backendCwd, env: { ...process.env, PORT: String(port) } }
);

// 2) 启动前端 Vite
const vite = spawnLogged(
  'npm',
  ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'],
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

  for (const refno of refnos) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('[StreamGenerate]') || text.includes('[Surreal→Xeokit]') || text.includes('[ViewerPanel]')) {
        process.stdout.write(`[browser] ${text}\n`);
      }
    });
    page.on('pageerror', (err) => process.stderr.write(`[pageerror] ${err}\n`));

    await page.goto(`${baseUrl}/?dtx_automation=1`, { waitUntil: 'domcontentloaded' });

    // 等待 Viewer 初始化并暴露到 window（DEV 模式下 ViewerPanel 会设置 window.__xeokitViewer）
    await page.waitForFunction(() => !!window.__xeokitViewer?.scene, null, { timeout: 120_000 });

    const initialTotalObjects = await page.evaluate(() => {
      const v = window.__xeokitViewer;
      const layer = v && v.__dtxLayer;
      const stats = layer && typeof layer.getStats === 'function' ? layer.getStats() : null;
      return Number(stats?.totalObjects || 0);
    });

    const prevRunId = await page.evaluate(() => String(window.__dtxShowModelByRefnos?.runId || ''));

    // 触发按需加载
    await page.evaluate((id) => {
      window.dispatchEvent(
        new CustomEvent('showModelByRefnos', {
          detail: { refnos: [id], regenModel: false },
        })
      );
    }, refno);

    // 等待 ViewerPanel 侧的调试状态回写（用于区分：加载失败/需要交互/无数据等）
    await page.waitForFunction(
      (prevId) => {
        const st = window.__dtxShowModelByRefnos;
        if (!st || typeof st !== 'object') return false;
        const runId = String(st.runId || '');
        if (!runId || runId === String(prevId || '')) return false;
        return String(st.status || '') === 'done';
      },
      prevRunId,
      { timeout: 300_000 }
    );

    const loadState = await page.evaluate(() => window.__dtxShowModelByRefnos || null);
    process.stdout.write(`[showModelByRefnos] refno=${refno} state=${JSON.stringify(loadState)}\n`);

    if (loadState?.error) {
      throw new Error(`[showModelByRefnos] failed: ${loadState.error}`);
    }
    const failedList = Array.isArray(loadState?.fail) ? loadState.fail : [];
    if (failedList.length > 0) {
      const sample = failedList.slice(0, 2).map((x) => x?.refno || x).join(',');
      throw new Error(`[showModelByRefnos] failCount=${failedList.length} sample=${sample}`);
    }

    // 输出 DTX 统计并按需断言（用于 1000 objects 级别压测）
    const stats = await page.evaluate(() => {
      const v = window.__xeokitViewer;
      const layer = v && v.__dtxLayer;
      return layer && typeof layer.getStats === 'function' ? layer.getStats() : null;
    });
    process.stdout.write(`[dtx] refno=${refno} stats=${JSON.stringify(stats)}\n`);

    const totalObjects = Number(stats?.totalObjects || 0);
    const deltaObjects = totalObjects - initialTotalObjects;

    // 若 showModelByRefnos 侧标记 ok，但实际没有任何对象增长，给出更明确的诊断
    if (deltaObjects <= 0) {
      const item0 = Array.isArray(loadState?.items) ? loadState.items[0] : null;
      const loadedObjectsReported = Number(item0?.loadDebug?.result?.loadedObjects || 0);
      const visibleOk = item0?.loadDebug?.visibleInsts?.ok;
      const visibleCount = Number(item0?.loadDebug?.visibleInsts?.count || 0);
      const visibleErr = item0?.loadDebug?.visibleInsts?.error;
      process.stdout.write(
        `[dtx][warn] no objects increased. reportedLoadedObjects=${loadedObjectsReported} visibleOk=${visibleOk} visibleCount=${visibleCount} visibleErr=${visibleErr || '-'}\n`
      );
    }

    // 某些 refno 可能没有可见几何子孙（则不会触发 DTX 编译/对象增长）；此处仅做兜底等待
    if (stats && stats.totalObjects > initialTotalObjects && stats.compiled !== true) {
      await page.waitForFunction(() => {
        const v = window.__xeokitViewer;
        const layer = v && v.__dtxLayer;
        const s = layer && typeof layer.getStats === 'function' ? layer.getStats() : null;
        return !!s && s.compiled === true;
      }, null, { timeout: 60_000 });
    }
    if (Number.isFinite(minObjects) && minObjects > 0) {
      if (!Number.isFinite(deltaObjects) || deltaObjects < minObjects) {
        throw new Error(`[dtx] 加载对象数不达标: delta=${deltaObjects} < ${minObjects} (refno=${refno})`);
      }
    }

    const safe = String(refno).replace(/[^\w.-]+/g, '_');
    const pngPath = path.join(artifactsDir, `${safe}.png`);
    await page.screenshot({ path: pngPath });
    process.stdout.write(`OK: loaded ${refno}, screenshot=${pngPath}\n`);

    try {
      await page.close();
    } catch {
      // ignore
    }
  }
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
