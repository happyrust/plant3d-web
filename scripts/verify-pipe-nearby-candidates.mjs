#!/usr/bin/env node
/**
 * N7：管道周边净距候选比对验收脚本（周边候选 × 同区逐根精算）
 *
 * 关联计划：docs/plans/2026-10-23-pipe-nearby-clearance-plan.md §2 N7 / §6
 * 覆盖场景：
 *   1. 后端冷启动可用性（不預加载三维模型，直接调 /api/v1/spatial/nearby/branches 必须返回 200）
 *   2. 密集管廊（24381_146830，重点核查隐式直管段邻管 144960 / 145892 / 146146 是否进候选）
 *   3. 长多段折管（24381_145018 / 24381_144947 / 24381_144872，核查候选数收敛且 0 漏检）
 *
 * 用法：
 *   node scripts/verify-pipe-nearby-candidates.mjs [--base-url http://123.57.182.243] [--project AvevaMarineSample] [--zone 24381_144870] [--radius 500]
 */

const args = process.argv.slice(2);
function getArg(flag, fallback) {
  const idx = args.indexOf(flag);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
}

const BASE_URL = (getArg('--base-url', process.env.PLANT3D_API_BASE || 'http://123.57.182.243')).replace(/\/+$/, '');
const PROJECT = getArg('--project', process.env.OUTPUT_PROJECT || 'AvevaMarineSample');
const ZONE_REFNO = getArg('--zone', '24381_144870').replace(/\//g, '_');
const RADIUS_MM = Number(getArg('--radius', '500'));
const SOURCES = getArg('--sources', '24381_146830,24381_145018,24381_144947,24381_144872')
  .split(',')
  .map(s => s.trim().replace(/\//g, '_'))
  .filter(Boolean);

const END_JOIN_TOLERANCE_MM = 1;
const CONNECTED_CLEARANCE_MM = 1;
const BRANCH_MARGIN_MM = 25;
const BRANCH_FITTING_NOUNS = new Set(['TEE', 'OLET', 'CROS']);

function normRefno(refno) {
  return String(refno || '').trim().replace(/\//g, '_');
}

async function apiGet(path, params = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set('output_project', PROJECT);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const t0 = performance.now();
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const elapsedMs = Math.round((performance.now() - t0) * 10) / 10;
  const body = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, elapsedMs, body };
}

async function apiPost(path, payload) {
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set('output_project', PROJECT);
  const t0 = performance.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  const elapsedMs = Math.round((performance.now() - t0) * 10) / 10;
  const body = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, elapsedMs, body };
}

function dist3(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function pointToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const lenSq = dx * dx + dy * dy + dz * dz;
  const t = lenSq > 0
    ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy + (p.z - a.z) * dz) / lenSq))
    : 0;
  return dist3(p, { x: a.x + dx * t, y: a.y + dy * t, z: a.z + dz * t });
}

function buildConnectivityLine(refno, centerline) {
  const segs = [];
  for (const seg of centerline?.segments ?? []) {
    if (!seg?.start || !seg?.end) return null;
    const od = Number(seg.outside_diameter_mm);
    segs.push({
      noun: String(seg.noun || '').toUpperCase(),
      start: seg.start,
      end: seg.end,
      od: Number.isFinite(od) && od > 0 ? od : 0,
    });
  }
  if (segs.length === 0) return null;
  return { refno, head: segs[0].start, tail: segs[segs.length - 1].end, segments: segs };
}

function endReaches(from, onto) {
  return [from.head, from.tail].some(pt =>
    onto.segments.some(seg => {
      const reach = BRANCH_FITTING_NOUNS.has(seg.noun)
        ? Math.max(dist3(seg.start, seg.end), 2 * seg.od) + BRANCH_MARGIN_MM
        : Math.max(seg.od / 2, 2 * seg.od) + BRANCH_MARGIN_MM;
      return pointToSegment(pt, seg.start, seg.end) <= reach;
    }),
  );
}

function pipeConnection(a, b) {
  if (!a || !b) return null;
  for (const p of [a.head, a.tail]) {
    for (const q of [b.head, b.tail]) {
      if (dist3(p, q) <= END_JOIN_TOLERANCE_MM) return 'ends';
    }
  }
  return endReaches(a, b) || endReaches(b, a) ? 'branch' : null;
}

async function listZoneBrans(zoneRefno) {
  const childrenRes = await apiGet('/api/v1/tree/children', { refno: zoneRefno });
  if (!childrenRes.ok) {
    throw new Error(`Failed to fetch zone children (${zoneRefno}): HTTP ${childrenRes.status}`);
  }
  const items = childrenRes.body?.items ?? childrenRes.body?.children ?? [];
  const brans = [];
  for (const item of items) {
    const noun = String(item.noun || '').toUpperCase();
    const refno = normRefno(item.refno);
    if (noun === 'BRAN') {
      brans.push(refno);
    } else if (noun === 'PIPE') {
      const sub = await apiGet('/api/v1/tree/children', { refno });
      for (const child of sub.body?.items ?? sub.body?.children ?? []) {
        if (String(child.noun || '').toUpperCase() === 'BRAN') {
          brans.push(normRefno(child.refno));
        }
      }
    }
  }
  return [...new Set(brans)];
}

async function mapConcurrent(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  async function runner() {
    while (cursor < items.length) {
      const idx = cursor++;
      out[idx] = await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runner()));
  return out;
}

async function main() {
  const health = await apiGet('/api/v1/health');
  const zoneBrans = await listZoneBrans(ZONE_REFNO);
  const centerlines = new Map();
  await mapConcurrent(zoneBrans, 8, async (refno) => {
    const res = await apiGet('/api/v1/spatial/centerline', { refno });
    if (res.ok && res.body) {
      centerlines.set(refno, buildConnectivityLine(refno, res.body));
    }
  });

  const reports = [];
  let hasFailure = false;

  for (const source of SOURCES) {
    const nearbyRes = await apiGet('/api/v1/spatial/nearby/branches', {
      refno: source,
      radius: RADIUS_MM,
      per_page: 1000,
    });
    if (!nearbyRes.ok) {
      hasFailure = true;
      reports.push({
        source,
        status: nearbyRes.status,
        nearbyLatencyMs: nearbyRes.elapsedMs,
        error: nearbyRes.body?.error?.message || nearbyRes.body?.message || `HTTP ${nearbyRes.status}`,
      });
      continue;
    }

    const candidateItems = nearbyRes.body?.results ?? [];
    const candidateRefnos = candidateItems.map(item => normRefno(item.refno));
    const candidateSet = new Set(candidateRefnos);
    const sourceLine = centerlines.get(source) ?? null;

    const peerBrans = zoneBrans.filter(target => target !== source);
    const exactChecks = await mapConcurrent(peerBrans, 6, async (target) => {
      const conn = pipeConnection(sourceLine, centerlines.get(target) ?? null);
      if (conn === 'ends') return null;
      const res = await apiPost('/api/v1/spatial/clearance/surface-to-surface', {
        source_refno: source,
        target_kind: 'any',
        target_refno: target,
        max_distance: RADIUS_MM,
      });
      const hit = res.body?.result;
      if (!res.ok || !hit || typeof hit.distance_mm !== 'number' || hit.distance_mm > RADIUS_MM) {
        return null;
      }
      if (conn === 'branch' && hit.distance_mm <= CONNECTED_CLEARANCE_MM) {
        return null;
      }
      return {
        refno: target,
        distanceMm: Math.round(hit.distance_mm * 10) / 10,
        sourceLeaf: normRefno(hit.source_leaf_refno),
        targetLeaf: normRefno(hit.target_leaf_refno),
        targetLeafNoun: hit.target_leaf_noun,
      };
    });

    const truthHits = exactChecks.filter(Boolean).sort((a, b) => a.distanceMm - b.distanceMm);
    const missed = truthHits.filter(hit => !candidateSet.has(hit.refno));
    if (missed.length > 0) {
      hasFailure = true;
    }

    const precision = candidateRefnos.length > 0
      ? Math.round((truthHits.length / candidateRefnos.length) * 1000) / 1000
      : 1;

    const report = {
      source,
      status: nearbyRes.status,
      nearbyLatencyMs: nearbyRes.elapsedMs,
      coverage: nearbyRes.body?.coverage ?? null,
      truncatedCandidates: Boolean(nearbyRes.body?.truncated_candidates),
      warnings: nearbyRes.body?.warnings ?? [],
      candidateCount: candidateRefnos.length,
      exactRequests: candidateRefnos.length,
      truthCount: truthHits.length,
      missedCount: missed.length,
      missed,
      precision,
    };

    if (source === '24381_146830') {
      const keyTubes = ['24381_144960', '24381_145892', '24381_146146'];
      report.keyImplicitTubeNeighbors = Object.fromEntries(
        keyTubes.map(refno => [refno, candidateSet.has(refno)]),
      );
      if (keyTubes.some(refno => !candidateSet.has(refno))) {
        hasFailure = true;
      }
    }

    reports.push(report);
  }

  const summary = {
    baseUrl: BASE_URL,
    project: PROJECT,
    zone: ZONE_REFNO,
    radiusMm: RADIUS_MM,
    zoneBranCount: zoneBrans.length,
    backendVersion: health.body?.version ?? null,
    overlayRoots: health.body?.model_cache?.overlay?.roots ?? health.body?.roots_ready ?? null,
    passed: !hasFailure,
    reports,
  };

  console.log(JSON.stringify(summary, null, 2));
  if (hasFailure) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});