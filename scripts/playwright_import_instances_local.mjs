import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
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

function mustOk(cond, msg) {
  if (!cond) throw new Error(msg);
}

function parseDbnoFromRefno(refno) {
  const s = String(refno || '').trim().replace('/', '_');
  const idx = s.indexOf('_');
  mustOk(idx > 0, `非法 refno（无法解析 dbno）: ${s}`);
  const n = Number(s.slice(0, idx));
  mustOk(Number.isFinite(n) && n > 0, `非法 dbno: ${s.slice(0, idx)}`);
  return n;
}

function pickRootRefnoFromInstances(manifest) {
  const list = manifest?.instances;
  if (Array.isArray(list) && list.length > 0) {
    // 优先挑一个“确实有几何实例”的 refno，否则后续 totalObjects>0 的等待条件会卡住。
    for (const it of list) {
      const geos = Array.isArray(it?.geo_instances) ? it.geo_instances : [];
      if (geos.length <= 0) continue;
      const r = String(it?.refno ?? '').trim().replace('/', '_');
      if (r) return r;
    }
    const r0 = String(list[0]?.refno ?? '').trim().replace('/', '_');
    if (r0) return r0;
  }
  const groups = manifest?.groups;
  if (Array.isArray(groups) && groups.length > 0) {
    const g0 = groups[0];
    const owner = String(g0?.owner_refno ?? '').trim().replace('/', '_');
    if (owner) return owner;
    const child = String(g0?.children?.[0]?.refno ?? '').trim().replace('/', '_');
    if (child) return child;
  }
  throw new Error('instances json 未包含可用 root refno（instances[0].refno / groups[0].owner_refno）');
}

function buildExpectedCountsByRefno(manifest) {
  const out = new Map();
  const add = (refno, n) => {
    const r = String(refno ?? '').trim().replace('/', '_');
    const nn = Number(n ?? 0);
    if (!r || !Number.isFinite(nn)) return;
    out.set(r, (out.get(r) || 0) + nn);
  };

  // gen-model-fork V0：instances[].geo_instances
  const list = manifest?.instances;
  if (Array.isArray(list)) {
    for (const it of list) {
      const refno = String(it?.refno ?? '').trim().replace('/', '_');
      if (!refno) continue;
      const geos = Array.isArray(it?.geo_instances) ? it.geo_instances : [];
      add(refno, geos.length);
    }
  }

  // export_dbnum_instances_json：groups[].children / groups[].tubings
  const groups = manifest?.groups;
  if (Array.isArray(groups)) {
    for (const g of groups) {
      for (const c of g?.children || []) {
        const refno = String(c?.refno ?? '').trim().replace('/', '_');
        if (!refno) continue;
        const insts = Array.isArray(c?.instances) ? c.instances : [];
        add(refno, insts.length);
      }
      for (const t of g?.tubings || []) {
        const refno = String(t?.refno ?? t?.uniforms?.refno ?? '').trim().replace('/', '_');
        if (!refno) continue;
        // tubings 每条记录就是一个实例
        add(refno, 1);
      }
    }
  }

  return out;
}

function buildAabbByRefno(manifest) {
  const map = new Map();
  const add = (refno, aabb) => {
    const r = String(refno ?? '').trim().replace('/', '_');
    const min = aabb?.min;
    const max = aabb?.max;
    if (!r || !Array.isArray(min) || !Array.isArray(max) || min.length < 3 || max.length < 3) return;
    const x0 = Number(min[0]), y0 = Number(min[1]), z0 = Number(min[2]);
    const x1 = Number(max[0]), y1 = Number(max[1]), z1 = Number(max[2]);
    if (![x0, y0, z0, x1, y1, z1].every((v) => Number.isFinite(v))) return;
    const prev = map.get(r);
    if (!prev) {
      map.set(r, { min: [x0, y0, z0], max: [x1, y1, z1] });
      return;
    }
    prev.min[0] = Math.min(prev.min[0], x0);
    prev.min[1] = Math.min(prev.min[1], y0);
    prev.min[2] = Math.min(prev.min[2], z0);
    prev.max[0] = Math.max(prev.max[0], x1);
    prev.max[1] = Math.max(prev.max[1], y1);
    prev.max[2] = Math.max(prev.max[2], z1);
  };

  const list = manifest?.instances;
  if (Array.isArray(list)) {
    for (const it of list) add(it?.refno, it?.aabb);
  }

  const groups = manifest?.groups;
  if (Array.isArray(groups)) {
    for (const g of groups) {
      for (const c of g?.children || []) add(c?.refno, c?.aabb);
      for (const t of g?.tubings || []) add(t?.refno ?? t?.uniforms?.refno, t?.aabb);
    }
  }
  return map;
}

function unionAabbForRefnos(aabbByRefno, refnos) {
  const list = Array.isArray(refnos) ? refnos : [];
  if (!aabbByRefno || typeof aabbByRefno.get !== 'function' || list.length === 0) return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let hasAny = false;
  for (const r of list) {
    const aabb = aabbByRefno.get(String(r ?? '').trim().replace('/', '_'));
    if (!aabb) continue;
    minX = Math.min(minX, aabb.min[0]); minY = Math.min(minY, aabb.min[1]); minZ = Math.min(minZ, aabb.min[2]);
    maxX = Math.max(maxX, aabb.max[0]); maxY = Math.max(maxY, aabb.max[1]); maxZ = Math.max(maxZ, aabb.max[2]);
    hasAny = true;
  }
  if (!hasAny) return null;
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

// 用法：
//   INSTANCES_PATH=/abs/path/to/instances_1112.json node scripts/playwright_import_instances_local.mjs
//
// 可选：
//   ROOT_REFNO=17496_106028
//   DBNO=17496
//   VITE_PORT=5173
//   EXPECT_REAL_GLB=1        # 断言至少有一个几何体不是 fallback box（需要后端 /files/meshes 可用）
//   EXPECT_NO_FALLBACK=1     # 断言所有几何体都不是 fallback box（更严格，要求后端 glb 都存在）
//   EXPECT_SCALE_MATCH=1     # 断言 manifest aabb 与 DTX 场景 bbox 的尺度同量级（粗略检测单位/主序问题）
//   SELECT_REFNO=17496_106028 # 选中并验证该构件（refno）
const instancesPath =
  String(process.env.INSTANCES_PATH || '').trim() ||
  '/Volumes/DPC/work/plant-code/gen-model-fork/output/instances/instances_1112.json';
const rawManifest = JSON.parse(readFileSync(instancesPath, 'utf-8'));
const rootRefno = String(process.env.ROOT_REFNO || '').trim().replace('/', '_') || pickRootRefnoFromInstances(rawManifest);
const dbno = Number(process.env.DBNO || parseDbnoFromRefno(rootRefno));
const envSelectRefno = String(process.env.SELECT_REFNO || '').trim().replace('/', '_');

const vitePort = await findFreePort(Number(process.env.VITE_PORT || 5173));
const baseUrl = `http://127.0.0.1:${vitePort}`;

const artifactsDir = path.resolve(process.cwd(), 'artifacts');
mkdirSync(artifactsDir, { recursive: true });
const pngPath = path.join(artifactsDir, `import_instances_${dbno}_${rootRefno.replace(/[^\w.-]+/g, '_')}.png`);
let selectedPngPath = '';
const expectRealGlb = process.env.EXPECT_REAL_GLB === '1';
const expectNoFallback = process.env.EXPECT_NO_FALLBACK === '1';
const expectScaleMatch = process.env.EXPECT_SCALE_MATCH === '1';

const expectedCountsByRefno = buildExpectedCountsByRefno(rawManifest);
const aabbByRefno = buildAabbByRefno(rawManifest);
const selectRefno =
  envSelectRefno ||
  Array.from(expectedCountsByRefno.entries()).find(([, n]) => Number(n || 0) > 0)?.[0] ||
  rootRefno;
selectedPngPath = path.join(
  artifactsDir,
  `import_instances_selected_${dbno}_${selectRefno.replace(/[^\w.-]+/g, '_')}.png`
);

process.stdout.write(`[test] instancesPath=${instancesPath}\n`);
process.stdout.write(`[test] dbno=${dbno}\n`);
process.stdout.write(`[test] rootRefno=${rootRefno}\n`);
process.stdout.write(`[test] selectRefno=${selectRefno}\n`);
process.stdout.write(`[test] manifestRefnos(with counts)=${expectedCountsByRefno.size}\n`);

const vite = spawnLogged(
  'npm',
  ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'],
  { cwd: process.cwd(), env: { ...process.env } }
);

let browser;
try {
  process.stdout.write(`[test] wait vite: ${baseUrl}\n`);
  await waitForHttpOk(baseUrl, 120_000);

  process.stdout.write('[test] launch chromium...\n');
  browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=swiftshader', '--enable-webgl'],
  });

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  process.stdout.write('[test] goto app...\n');
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[ViewerPanel]') || text.includes('[dtx]') || text.includes('[DTXLayer]')) {
      process.stdout.write(`[browser] ${text}\n`);
    }
  });
  page.on('pageerror', (err) => process.stderr.write(`[pageerror] ${err}\n`));

  await page.goto(`${baseUrl}/?dtx_automation=1`, { waitUntil: 'domcontentloaded' });

  const webgl2Ok = await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'));
  process.stdout.write(`[test] webgl2=${webgl2Ok}\n`);

  // 等待 Viewer 初始化并暴露到 window
  await page.waitForFunction(() => !!window.__xeokitViewer?.scene, null, { timeout: 120_000 });

  process.stdout.write('[test] viewer ready\n');

  // 激活“管理”面板（否则 ToolManagerPanel 可能未挂载）
  // 优先走 useDockApi.ensurePanelAndActivate（避免 DockLayout 的 togglePanel 把已存在面板关闭）
  await page
    .evaluate(async () => {
      try {
        const m = await import('/src/composables/useDockApi.ts');
        if (m && typeof m.ensurePanelAndActivate === 'function') {
          m.ensurePanelAndActivate('manager');
        }
      } catch {
        // ignore
      }
    })
    .catch(() => {});
  // DOM 点击兜底
  const byText = page.getByText('管理', { exact: true });
  if ((await byText.count()) > 0) {
    await byText.first().click({ timeout: 5_000 }).catch(() => {});
  }

  process.stdout.write('[test] wait manager import section...\n');
  await page.waitForSelector('text=DTX / Instances 导入（开发用）', { timeout: 60_000 });
  const section = page.locator('div', { hasText: 'DTX / Instances 导入（开发用）' }).first();

  // 上传文件（hidden input 也可以 setInputFiles）
  await section.locator('input[type="file"][accept="application/json"]').setInputFiles(instancesPath);

  // 填充 dbno / rootRefno（文件名不一定等于 refno dbno，因此用 refno 推导）
  await section.locator('input[placeholder="dbno"]').fill(String(dbno));
  await section.locator('input[placeholder^="root refno"]').fill(String(rootRefno));

  await section.getByRole('button', { name: '导入并加载' }).click();

  // 等待 DTXLayer 产生对象并编译完成（后端缺失时也会走 fallback box geometry）
  await page.waitForFunction(() => {
    const v = window.__xeokitViewer;
    const layer = v && v.__dtxLayer;
    const stats = layer && typeof layer.getStats === 'function' ? layer.getStats() : null;
    return !!stats && stats.compiled === true && Number(stats.totalObjects || 0) > 0;
  }, null, { timeout: 180_000 });

  const stats = await page.evaluate(() => {
    const v = window.__xeokitViewer;
    const layer = v && v.__dtxLayer;
    return layer && typeof layer.getStats === 'function' ? layer.getStats() : null;
  });
  process.stdout.write(`[test] dtx stats=${JSON.stringify(stats)}\n`);

  // 1) 对象总数：应等于“本次实际加载 refno 集合”的预期实例数之和（从 manifest 侧统计）
  const loadedRefnos = await page.evaluate(() => {
    const v = window.__xeokitViewer;
    const list = v && (v.__dtxLastLoadedRefnos || v.__dtxLoadedRefnos);
    return Array.isArray(list) ? list : [];
  });
  mustOk(Array.isArray(loadedRefnos) && loadedRefnos.length > 0, `[test] 无法获取 loadedRefnos: got=${JSON.stringify(loadedRefnos)}`);

  const uniqLoadedRefnos = Array.from(new Set(loadedRefnos.map((r) => String(r ?? '').trim().replace('/', '_')).filter(Boolean)));
  const expectedEntries = [];
  let expectedTotalObjects = 0;
  for (const refno of uniqLoadedRefnos) {
    const expected = Number(expectedCountsByRefno.get(refno) || 0);
    expectedEntries.push([refno, expected]);
    expectedTotalObjects += expected;
  }
  mustOk(
    Number(stats?.totalObjects || 0) === expectedTotalObjects,
    `[test] totalObjects 不匹配: got=${Number(stats?.totalObjects || 0)} expected=${expectedTotalObjects}`
  );

  // 2) refno->objectIds 映射：通过 objectId 命名规则 o:<refno>:<n> 反解统计（避免 Vite HMR 导致模块实例不同）
  const refnoCountCheck = await page.evaluate((expectedEntries) => {
    const v = window.__xeokitViewer;
    const layer = v && v.__dtxLayer;
    if (!layer || typeof layer.getAllObjectIds !== 'function') return { ok: false, error: 'missing layer.getAllObjectIds' };

    const ids = layer.getAllObjectIds();
    const counts = {};
    for (const id of ids) {
      if (typeof id !== 'string' || !id.startsWith('o:')) continue;
      const parts = id.split(':');
      const refno = parts.length >= 3 ? String(parts[1] || '') : '';
      if (!refno) continue;
      counts[refno] = (counts[refno] || 0) + 1;
    }

    const mismatches = [];
    for (const pair of expectedEntries || []) {
      const refno = String(pair?.[0] || '');
      const expected = Number(pair?.[1] || 0);
      const got = Number(counts[refno] || 0);
      if (got !== expected) mismatches.push({ refno, got, expected });
    }
    return { ok: mismatches.length === 0, totalObjects: ids.length, uniqueRefnos: Object.keys(counts).length, mismatches };
  }, expectedEntries);
  mustOk(refnoCountCheck && refnoCountCheck.ok === true, `[test] refno objects 不匹配: ${JSON.stringify(refnoCountCheck)}`);

  // 3) bbox 有效性：抽样检查 object bbox 必须非空且值有限
  const bboxCheck = await page.evaluate(() => {
    const v = window.__xeokitViewer;
    const layer = v && v.__dtxLayer;
    if (!layer || typeof layer.getAllObjectIds !== 'function' || typeof layer.getObjectBoundingBox !== 'function') {
      return { ok: false, error: 'missing bbox APIs' };
    }
    const ids = layer.getAllObjectIds();
    const sample = ids.slice(0, 50);
    let bad = 0;
    for (const id of sample) {
      const b = layer.getObjectBoundingBox(id);
      if (!b || typeof b.isEmpty !== 'function' || b.isEmpty()) {
        bad++;
        continue;
      }
      const vals = [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z];
      if (!vals.every((x) => Number.isFinite(x))) bad++;
    }
    return { ok: bad === 0, sampled: sample.length, bad };
  });
  mustOk(bboxCheck && bboxCheck.ok === true, `[test] bbox check failed: ${JSON.stringify(bboxCheck)}`);

  // 4) fallback box 检测：利用内部几何句柄 vertexCount/indexCount 识别（测试用）
  const fallbackInfo = await page.evaluate(() => {
    const v = window.__xeokitViewer;
    const layer = v && v.__dtxLayer;
    const geos = layer && layer._geometries ? Array.from(layer._geometries.values()) : [];
    let fallback = 0;
    const fallbackGeoHashes = [];
    for (const g of geos) {
      // 尝试区分“真实 box glb”与“前端 fallback box”：
      // - 两者 vertexCount/indexCount 都可能是 24/36
      // - 但 fallback box 的局部 bbox 基本固定为 [-0.5,0.5]（尺寸 1）
      if (g && g.vertexCount === 24 && g.indexCount === 36) {
        const b = layer?._geometryLocalBBoxes?.get?.(g.geoHash);
        const min = b?.min;
        const max = b?.max;
        const sizeX = max && min ? (max.x - min.x) : NaN;
        const sizeY = max && min ? (max.y - min.y) : NaN;
        const sizeZ = max && min ? (max.z - min.z) : NaN;
        const looksLikeFallback =
          Number.isFinite(sizeX) &&
          Number.isFinite(sizeY) &&
          Number.isFinite(sizeZ) &&
          Math.abs(sizeX - 1) < 1e-3 &&
          Math.abs(sizeY - 1) < 1e-3 &&
          Math.abs(sizeZ - 1) < 1e-3 &&
          Math.abs((min?.x ?? 0) + 0.5) < 1e-3 &&
          Math.abs((min?.y ?? 0) + 0.5) < 1e-3 &&
          Math.abs((min?.z ?? 0) + 0.5) < 1e-3 &&
          Math.abs((max?.x ?? 0) - 0.5) < 1e-3 &&
          Math.abs((max?.y ?? 0) - 0.5) < 1e-3 &&
          Math.abs((max?.z ?? 0) - 0.5) < 1e-3;
        if (looksLikeFallback) {
          fallback++;
          fallbackGeoHashes.push(String(g.geoHash || ''));
        }
      }
    }
    return { uniqueGeometries: geos.length, fallback, fallbackGeoHashes: fallbackGeoHashes.slice(0, 10) };
  });
  process.stdout.write(`[test] geometry fallback=${JSON.stringify(fallbackInfo)}\n`);

  // 5) GPU picking：尝试在屏幕中心附近拾取，确认可命中对象（间接验证 pickingTexture + primitive->object）
  // 注意：page.evaluate 不是 ESM 环境，不能直接 import('three')，因此这里传入 plain {x,y}（运行时只读属性）。
  const pickResult = await page.evaluate(() => {
    const v = window.__xeokitViewer;
    const sel = v && v.__dtxSelection;
    const layer = v && v.__dtxLayer;
    const canvas = document.querySelector('canvas.viewer');
    if (!sel || !layer || !canvas) return { ok: false, error: 'missing selection/layer/canvas' };
    const rect = canvas.getBoundingClientRect();

    const tries = [
      [0.50, 0.50],
      [0.45, 0.50],
      [0.55, 0.50],
      [0.50, 0.45],
      [0.50, 0.55],
      [0.40, 0.50],
      [0.60, 0.50],
      [0.50, 0.40],
      [0.50, 0.60],
    ];

    const all = typeof layer.getAllObjectIds === 'function' ? layer.getAllObjectIds() : [];
    for (const [fx, fy] of tries) {
      const x = rect.width * fx;
      const y = rect.height * fy;
      const res = sel.pick({ x, y });
      if (res && res.objectId && all.includes(res.objectId)) {
        return { ok: true, hit: { objectId: res.objectId, objectIndex: res.objectIndex }, tried: tries.length };
      }
    }
    return { ok: false, hit: null, tried: tries.length };
  });
  mustOk(pickResult && pickResult.ok === true, `[test] pick failed: ${JSON.stringify(pickResult)}`);

  await page.screenshot({ path: pngPath });

  // 6) 三维“选中构件”（refno 级）：通过 compat.scene.setObjectsSelected → selectionController.select → Outline
  const selectCheck = await page.evaluate((refnoArg) => {
    const v = window.__xeokitViewer;
    const sel = v && v.__dtxSelection;
    const layer = v && v.__dtxLayer;
    const refno = String(refnoArg || '').trim().replace('/', '_');
    if (!v || !sel || !layer) return { ok: false, error: 'missing viewer/selection/layer' };

    const all = typeof layer.getAllObjectIds === 'function' ? layer.getAllObjectIds() : [];
    const want = all.filter((id) => typeof id === 'string' && id.startsWith(`o:${refno}:`));
    if (want.length === 0) {
      return { ok: false, error: 'no objectIds for refno', refno, totalObjects: all.length };
    }

    try {
      sel.clearSelection?.();
    } catch {
      // ignore
    }

    try {
      v.scene?.setObjectsSelected?.([refno], true);
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }

    const selected = typeof sel.getSelected === 'function' ? sel.getSelected() : [];
    const hasOutline = typeof sel.hasOutlinedObjects === 'function' ? sel.hasOutlinedObjects() : false;
    const missing = want.filter((id) => !selected.includes(id));
    return {
      ok: missing.length === 0 && selected.length >= want.length && hasOutline === true,
      refno,
      wantCount: want.length,
      selectedCount: selected.length,
      missing: missing.slice(0, 5),
      hasOutline,
    };
  }, selectRefno);
  mustOk(selectCheck && selectCheck.ok === true, `[test] select failed: ${JSON.stringify(selectCheck)}`);
  process.stdout.write(`[test] select ok: ${JSON.stringify(selectCheck)}\n`);

  await page.waitForTimeout(200);
  await page.screenshot({ path: selectedPngPath });

  if (expectRealGlb) {
    // fallback box: 24 vertices per geometry；若全部都是 box，totalVertices === uniqueGeometries * 24
    const totalVertices = Number(stats?.totalVertices || 0);
    const uniqueGeometries = Number(stats?.uniqueGeometries || 0);
    mustOk(uniqueGeometries > 0, '[test] EXPECT_REAL_GLB=1 但 uniqueGeometries=0');
    mustOk(
      totalVertices > uniqueGeometries * 24,
      `[test] EXPECT_REAL_GLB=1 失败：看起来所有几何体都走了 fallback box（totalVertices=${totalVertices}, uniqueGeometries=${uniqueGeometries}）`
    );
  }
  if (expectNoFallback) {
    mustOk(
      fallbackInfo && Number(fallbackInfo.fallback || 0) === 0,
      `[test] EXPECT_NO_FALLBACK=1 失败：fallback geometries=${Number(fallbackInfo?.fallback || 0)}/${Number(fallbackInfo?.uniqueGeometries || 0)}`
    );
  }

  if (expectScaleMatch) {
    const expectedSceneAabb = unionAabbForRefnos(aabbByRefno, uniqLoadedRefnos);
    mustOk(!!expectedSceneAabb, '[test] EXPECT_SCALE_MATCH=1 但无法从 manifest(aabb) 构建 expectedSceneAabb');
    const dtxBox = await page.evaluate(() => {
      const v = window.__xeokitViewer;
      const layer = v && v.__dtxLayer;
      const box = layer && typeof layer.getBoundingBox === 'function' ? layer.getBoundingBox() : null;
      if (!box) return null;
      const size = { x: box.max.x - box.min.x, y: box.max.y - box.min.y, z: box.max.z - box.min.z };
      return { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z], size };
    });
    mustOk(!!dtxBox, '[test] EXPECT_SCALE_MATCH=1 但无法获取 DTX bbox');

    const expSize = {
      x: expectedSceneAabb.max[0] - expectedSceneAabb.min[0],
      y: expectedSceneAabb.max[1] - expectedSceneAabb.min[1],
      z: expectedSceneAabb.max[2] - expectedSceneAabb.min[2],
    };
    const expMaxDim = Math.max(Math.abs(expSize.x), Math.abs(expSize.y), Math.abs(expSize.z));
    const gotMaxDim = Math.max(Math.abs(dtxBox.size.x), Math.abs(dtxBox.size.y), Math.abs(dtxBox.size.z));
    const ratio = expMaxDim > 0 ? gotMaxDim / expMaxDim : Infinity;
    mustOk(
      Number.isFinite(ratio) && ratio > 0.1 && ratio < 10,
      `[test] EXPECT_SCALE_MATCH=1 失败：bbox 尺度疑似不一致 ratio=${ratio} (gotMaxDim=${gotMaxDim}, expMaxDim=${expMaxDim})`
    );
  }

  process.stdout.write(`[test] ✅ OK screenshot=${pngPath}\n`);
  process.stdout.write(`[test] ✅ selected screenshot=${selectedPngPath}\n`);

  try {
    await page.close();
  } catch {
    // ignore
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
}
