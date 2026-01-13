// 模拟测试：visible-insts + instances_{dbno}.json 加载链路（不依赖 WebGL）
//
// 用法：
// 1) 启动后端（确保 /api/e3d 与 /files 可访问）
// 2) 运行：
//    VITE_GEN_MODEL_API_BASE_URL=http://localhost:8080 node scripts/test_load_visible_instances_17496_106028.mjs
//
// 可选参数：
//   REFNO=17496_106028
//   LOD=L1
//   MAX_REFNOS=200
//   CHECK_GLB=1

const API_BASE = (process.env.VITE_GEN_MODEL_API_BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
const REFNO = process.env.REFNO || '17496_106028';
const LOD = process.env.LOD || 'L1';
const MAX_REFNOS = Number(process.env.MAX_REFNOS || '200');
const CHECK_GLB = process.env.CHECK_GLB === '1';

function mustOk(cond, msg) {
  if (!cond) {
    throw new Error(msg);
  }
}

function parseDbno(refno) {
  const s = String(refno);
  const idx = s.indexOf('_');
  mustOk(idx > 0, `非法 refno（无法解析 dbno）: ${s}`);
  const dbno = Number(s.slice(0, idx));
  mustOk(Number.isFinite(dbno) && dbno > 0, `非法 dbno: ${s.slice(0, idx)}`);
  return dbno;
}

function buildInstanceIndexByRefno(instancesManifest) {
  const index = new Map();
  const groups = []
    .concat(instancesManifest?.ungrouped || [])
    .concat(instancesManifest?.bran_groups || [])
    .concat(instancesManifest?.equi_groups || []);

  for (const row of groups) {
    const refno = String(row.refno || '');
    if (!refno) continue;
    const list = index.get(refno) || [];
    list.push(row);
    index.set(refno, list);
  }
  return index;
}

async function fetchJson(url) {
  const resp = await fetch(url);
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status} ${resp.statusText}: ${url}\n${text}`);
  }
  return await resp.json();
}

async function headOrSmallGet(url) {
  const head = await fetch(url, { method: 'HEAD' }).catch(() => null);
  if (head && head.ok) return true;
  if (head && head.status !== 405 && head.status !== 404) {
    return false;
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 1500);
  try {
    const resp = await fetch(url, { signal: ac.signal });
    return resp.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log(`[test] API_BASE=${API_BASE}`);
  console.log(`[test] REFNO=${REFNO}`);

  const dbno = parseDbno(REFNO);

  const visibleUrl = `${API_BASE}/api/e3d/visible-insts/${encodeURIComponent(REFNO)}`;
  const visible = await fetchJson(visibleUrl);
  mustOk(visible && visible.success === true, `[test] visible-insts 失败: ${JSON.stringify(visible).slice(0, 300)}`);

  const visibleRefnos = Array.isArray(visible.refnos) ? visible.refnos.map(String) : [];
  mustOk(visibleRefnos.length > 0, `[test] visible-insts 返回空 refnos: ${JSON.stringify(visible).slice(0, 300)}`);

  console.log(`[test] visible refnos=${visibleRefnos.length}`);

  const instUrl = `${API_BASE}/files/output/instances/instances_${dbno}.json`;
  const manifest = await fetchJson(instUrl);
  mustOk(manifest && typeof manifest === 'object', `[test] instances json 解析失败: ${instUrl}`);

  const index = buildInstanceIndexByRefno(manifest);
  mustOk(index.size > 0, `[test] instances manifest 未包含任何 refno 记录: ${instUrl}`);

  const sample = visibleRefnos.slice(0, Math.max(1, Math.min(MAX_REFNOS, visibleRefnos.length)));
  let missing = 0;
  for (const r of sample) {
    if (!index.has(r)) missing++;
  }

  mustOk(
    missing === 0,
    `[test] instances_${dbno}.json 缺少可见 refno 记录: missing=${missing}/${sample.length}（示例=${sample.slice(0, 5).join(',')}）`
  );

  console.log(`[test] instances 命中校验通过: ${sample.length}/${sample.length}`);

  if (CHECK_GLB) {
    // 额外检查：随机抽取一些 geo_hash，确认 glb 文件可访问
    const geoHashes = new Set();
    for (const r of sample.slice(0, 50)) {
      const rows = index.get(r) || [];
      for (const row of rows) {
        const insts = row.instances || [];
        for (const inst of insts) {
          if (inst && inst.geo_hash != null) geoHashes.add(String(inst.geo_hash));
        }
      }
    }
    const list = Array.from(geoHashes).slice(0, 20);
    console.log(`[test] glb 抽检 geo_hash=${list.length}`);
    let bad = 0;
    for (const h of list) {
      const glbUrl = `${API_BASE}/files/meshes/lod_${LOD}/${encodeURIComponent(h)}_${LOD}.glb`;
      const ok = await headOrSmallGet(glbUrl);
      if (!ok) {
        bad++;
        console.warn(`[test] glb 不可访问: ${glbUrl}`);
      }
    }
    mustOk(bad === 0, `[test] glb 抽检失败: bad=${bad}/${list.length}`);
    console.log('[test] glb 抽检通过');
  }

  console.log('[test] ✅ visible-insts + instances_{dbno}.json 模拟加载测试通过');
}

main().catch((e) => {
  console.error('[test] ❌ 失败:', e?.stack || e?.message || String(e));
  process.exitCode = 1;
});

