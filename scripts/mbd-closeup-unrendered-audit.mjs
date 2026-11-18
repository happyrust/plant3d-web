#!/usr/bin/env node
/**
 * #140：全量数一遍三维呈现下「对着看也不画」的三类记录（及「主尺寸被藏、附加小字还留着」专项统计）。
 *
 * 在全部走通对象（ok）的离线最终标注包上，用前端真内核 + 页面同一套裁剪面分档规则跑：
 *   1) 包级三档相机：默认斜俯视（1.15×）、正前对焦标注（1.05×）、拉近中景（0.45×）+ 各直段中景；
 *   2) 逐记录对焦相机：4 档可达距离（1.08×near、1.8×near、4×near、10×near）× 3 个视线方向
 *      （等轴测 [1,1,0.8]、顶前斜视 [0,-0.25,1]、侧斜视 [1,-0.2,0.25]；角度尺寸另加弧法向正对机位）。
 *
 * 输出：
 *   - 类别 1：读数相压被藏（在所测全部包级与逐条对焦机位/方向下均因 overlap 未画出）；
 *   - 专项单列：主尺寸被相压/短线藏掉、但挂在它上面的附加小字（调整焊 `+50` / 定位尺寸方向小字）仍留在屏幕上；
 *   - 类别 2：被远裁剪面切掉（对比仅按模型本体定裁剪面 vs #139 纳入外伸标注后的对象与记录数）；
 *   - 类别 3：字高太小、近不过近裁剪面（对比 #138 修复后结果）；
 *   - 必看样本逐项核对：24381_178118、24383_76302、24381_147426、24381_103704、24381_103159、24381_38695(24381_38940)。
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq > 0) {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const payloadDir = path.resolve(
  repoRoot,
  String(args['payload-dir'] ?? '../plant3d-web/.scratch/mbd-impl/host2/respond-final-b4-641284675'),
);
const outJson = args['out-json'] ? path.resolve(repoRoot, String(args['out-json'])) : null;
const viteCacheDir = path.resolve(
  repoRoot,
  String(args['vite-cache-dir'] ?? '../plant3d-web/.scratch/land-1118/vite-cache-audit'),
);

async function loadFrontend() {
  const { createServer } = await import('vite');
  const server = await createServer({
    configFile: false,
    root: repoRoot,
    cacheDir: viteCacheDir,
    logLevel: 'error',
    appType: 'custom',
    resolve: { alias: { '@': path.join(repoRoot, 'src') } },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const [contract, mapper, normalize, kernel, sceneGeo, projectorMod, clipMod, three] = await Promise.all([
      server.ssrLoadModule('/src/dimension/adapters/mbdV2Contract.ts'),
      server.ssrLoadModule('/src/dimension/adapters/mbdV2ExternalAnnotations.ts'),
      server.ssrLoadModule('/src/dimension/adapters/normalizeExternalDimensions.ts'),
      server.ssrLoadModule('/src/dimension/kernel/index.ts'),
      server.ssrLoadModule('/src/dimension/kernel/geometry/sceneGeometry.ts'),
      server.ssrLoadModule('/src/dimension/viewport/threeViewportProjector.ts'),
      server.ssrLoadModule('/src/viewer/camera/clipPlanes.ts'),
      import('three'),
    ]);
    const font = kernel.LffFont.fromText(
      gunzipSync(readFileSync(path.join(repoRoot, 'public', 'fonts', 'unicode.lff.bin'))).toString('utf8'),
    );
    return {
      close: () => server.close(),
      parseMbdV2PipeData: contract.parseMbdV2PipeData,
      mbdV2ToExternalRecords: mapper.mbdV2ToExternalRecords,
      externalDimensionBounds: normalize.externalDimensionBounds,
      normalizeExternalDimension: normalize.normalizeExternalDimension,
      layoutViewport: kernel.layoutViewport,
      theme: kernel.SOLVESPACE_DIMENSION_THEME,
      format: kernel.DEFAULT_DIMENSION_FORMAT,
      isClippedPrimitive: sceneGeo.isClippedPrimitive,
      ThreeViewportProjector: projectorMod.ThreeViewportProjector,
      computeClipPlanesByDiag: clipMod.computeClipPlanesByDiag,
      computeSceneClipPlanes: clipMod.computeSceneClipPlanes,
      three,
      font,
    };
  } catch (error) {
    await server.close();
    throw error;
  }
}

function loadIndexStatuses(dir) {
  try {
    const map = new Map();
    for (const line of readFileSync(path.join(dir, 'index.jsonl'), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      const key = String(row.file ?? `${row.refno}.json`).replace(/\.json$/, '');
      map.set(key, Number(row.status ?? 200));
    }
    return map;
  } catch {
    return null;
  }
}

function makeProjector(fe, centerArr, distM, dirArr, planes, fovDeg = 50) {
  const { PerspectiveCamera, Matrix4, Vector3 } = fe.three;
  const center = new Vector3(centerArr[0], centerArr[1], centerArr[2]);
  const dir = new Vector3(dirArr[0], dirArr[1], dirArr[2]).normalize();
  const camera = new PerspectiveCamera(fovDeg, 1920 / 1080, planes.near, planes.far);
  if (Math.abs(dir.z) > 0.92) camera.up.set(0, 1, 0);
  else camera.up.set(0, 0, 1);
  camera.position.copy(center).addScaledVector(dir, distM);
  camera.lookAt(center);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return new fe.ThreeViewportProjector({
    camera,
    designToWorld: new Matrix4(),
    widthCssPx: 1920,
    heightCssPx: 1080,
    dpr: 1,
  });
}

function isLayoutVisibleOnScreen(fe, layout) {
  return layout.primitives.some(prim => !fe.isClippedPrimitive(prim));
}

/** 找出包内挂在主尺寸上的附加小字（调整焊 `+50`、定位方向小字 `:dirtext`）→ 宿主主尺寸 id。 */
function findCompanionParentMap(payload) {
  const map = new Map();
  const dims = (payload.primitives ?? []).filter(pr => pr.kind === 'linear_dim');
  const dimById = new Map(dims.map(d => [d.id, d]));
  for (const pr of payload.primitives ?? []) {
    if (pr.kind !== 'aid_text') continue;
    if (typeof pr.id === 'string' && pr.id.endsWith(':dirtext')) {
      const hostId = pr.id.slice(0, -':dirtext'.length);
      if (dimById.has(hostId)) {
        map.set(pr.id, { hostId, kind: '标注方向' });
        continue;
      }
    }
    if (pr.function === '调整焊附加长度' || String(pr.id).includes(':adjustweld:')) {
      const sameIso = dims.filter(d => d.isoline_idx === pr.isoline_idx);
      const pool = sameIso.length > 0 ? sameIso : dims;
      let best = null;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const d of pool) {
        const dist = Math.hypot(
          d.label_anchor[0] - pr.position[0],
          d.label_anchor[1] - pr.position[1],
          d.label_anchor[2] - pr.position[2],
        );
        if (dist < bestDist) {
          bestDist = dist;
          best = d;
        }
      }
      if (best) {
        map.set(pr.id, { hostId: best.id, kind: '调整焊附加长度' });
      }
    }
  }
  return map;
}

/**
 * 估算对象本体的几何对角线（米）：
 * - 对含有 `equipment.base_far_from_geometry`（原点留在世界原点、设备本体在远处）的复制设备，
 *   剔除落在原点 `[0,0,0]` 附近的偏转角辅助线后取设备本体点集跨度（下限 0.8 m，< 1 m 小设备档）；
 * - 其余对象无离线网格包围盒时以标注主体范围估算模型量级。
 */
function estimateModelBodyDiagM(payload, fullDiagM) {
  const hasFarOriginIssue = (payload.issues ?? []).some(
    iss => iss.rule_id === 'equipment.base_far_from_geometry',
  );
  if (!hasFarOriginIssue) return Math.max(0.2, fullDiagM);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let count = 0;
  for (const pr of payload.primitives ?? []) {
    for (const pt of [pr.start, pr.end, pr.position, pr.center, pr.label_anchor]) {
      if (!Array.isArray(pt) || pt.length !== 3) continue;
      if (Math.hypot(pt[0], pt[1], pt[2]) < 1500) continue;
      count += 1;
      for (let i = 0; i < 3; i += 1) {
        min[i] = Math.min(min[i], pt[i] * 0.001);
        max[i] = Math.max(max[i], pt[i] * 0.001);
      }
    }
  }
  if (count === 0) return 0.8;
  return Math.max(0.5, Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]));
}

function recordFocusPoint(input) {
  if ('lines' in input) {
    return input.tag?.target ?? input.labelAnchor;
  }
  return [0, 0, 0];
}

function dist3(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function createCategoryCounter() {
  return {
    recordCount: 0,
    candidateObjects: new Set(),
    subjectObjects: new Set(),
    byType: {},
    samples: [],
  };
}

function recordHit(counter, { refno, subjectRefno, annotationType, recordId, detail }) {
  counter.recordCount += 1;
  counter.candidateObjects.add(refno);
  counter.subjectObjects.add(subjectRefno);
  const t = annotationType || 'unknown';
  if (!counter.byType[t]) {
    counter.byType[t] = { records: 0, subjects: new Set(), samples: [] };
  }
  counter.byType[t].records += 1;
  counter.byType[t].subjects.add(subjectRefno);
  const sampleTag = `${refno}(${recordId}${detail ? `: ${detail}` : ''})`;
  if (counter.byType[t].samples.length < 5) counter.byType[t].samples.push(sampleTag);
  if (counter.samples.length < 25) counter.samples.push(sampleTag);
}

const WATCH_SAMPLES = new Set([
  '24381_178118',
  '24383_76302',
  '24381_147426',
  '24381_103704',
  '24381_103159',
  '24381_127703',
  '24381_133122',
  '24381_38695',
]);

async function main() {
  const startedAt = Date.now();
  const fe = await loadFrontend();
  try {
    const statuses = loadIndexStatuses(payloadDir);
    const files = readdirSync(payloadDir).filter(name => /^\d+_\d+\.json$/.test(name));

    const overlapCounter = createCategoryCounter();
    const orphanCompanionCounter = createCategoryCounter();
    const farClipModelOnlyCounter = createCategoryCounter();
    const farClipFixedCounter = createCategoryCounter();
    const tinyTextNearCounter = createCategoryCounter();
    const shortLineCloseUpCounter = createCategoryCounter();

    const watchedDetails = {};
    let okPackages = 0;
    const okSubjects = new Set();
    let totalRecords = 0;

    for (let idx = 0; idx < files.length; idx += 1) {
      const file = files[idx];
      const refno = file.replace(/\.json$/, '');
      const status = statuses ? (statuses.get(refno) ?? 200) : 200;
      if (status !== 200) continue;

      const raw = JSON.parse(readFileSync(path.join(payloadDir, file), 'utf8'));
      const parsed = fe.parseMbdV2PipeData(raw);
      if (!parsed.ok) continue;
      const payload = parsed.data;
      if (payload.primitives.length === 0) continue;
      if (payload.issues.some(iss => iss.severity === 'error')) continue;
      const mapped = fe.mbdV2ToExternalRecords(payload);
      if (mapped.skipped.length > 0 || mapped.records.length === 0) continue;

      const bounds = fe.externalDimensionBounds(mapped.records);
      if (!bounds) continue;

      okPackages += 1;
      const subjectRefno = payload.subject?.refno ?? refno;
      okSubjects.add(subjectRefno);
      const annotationType = payload.annotation_type ?? 'unknown';

      const inputs = mapped.records.map(r => fe.normalizeExternalDimension(r));
      totalRecords += inputs.length;

      const center = [
        (bounds.min[0] + bounds.max[0]) / 2,
        (bounds.min[1] + bounds.max[1]) / 2,
        (bounds.min[2] + bounds.max[2]) / 2,
      ];
      const fullDiagM = Math.hypot(
        bounds.max[0] - bounds.min[0],
        bounds.max[1] - bounds.min[1],
        bounds.max[2] - bounds.min[2],
      );
      const radiusM = Math.max(0.05, fullDiagM / 2);
      const fovDeg = 50;
      const fitDistM = (radiusM / Math.sin((fovDeg * Math.PI) / 360)) * 1.15;

      const modelBodyDiagM = estimateModelBodyDiagM(payload, fullDiagM);
      const modelOnlyPlanes = fe.computeClipPlanesByDiag(modelBodyDiagM);
      const fixedPlanes = fe.computeSceneClipPlanes({
        modelDiagM: modelBodyDiagM,
        combinedDiagM: fullDiagM,
      });

      // Check far-plane clipping in fit-to-annotations view (with LOD off so pure frustum clipping is isolated):
      const bareInputs = inputs.map(inp => ('lod' in inp ? { ...inp, lod: undefined } : inp));
      if (modelOnlyPlanes.far !== fixedPlanes.far || WATCH_SAMPLES.has(refno)) {
        const projOld = makeProjector(fe, center, fitDistM, [1, 1, 0.8], modelOnlyPlanes, fovDeg);
        const batchOld = fe.layoutViewport(
          bareInputs,
          { projector: projOld, font: fe.font, theme: fe.theme, format: fe.format },
          new Map(),
        );
        const projNew = makeProjector(fe, center, fitDistM, [1, 1, 0.8], fixedPlanes, fovDeg);
        const batchNew = fe.layoutViewport(
          bareInputs,
          { projector: projNew, font: fe.font, theme: fe.theme, format: fe.format },
          new Map(),
        );
        for (let rIdx = 0; rIdx < bareInputs.length; rIdx += 1) {
          const focusPt = recordFocusPoint(bareInputs[rIdx]);
          const oldDepth = projOld.project(focusPt).depth;
          const newDepth = projNew.project(focusPt).depth;
          const lOld = batchOld.layouts[rIdx];
          const lNew = batchNew.layouts[rIdx];
          if (!isLayoutVisibleOnScreen(fe, lOld) && !lOld.derived?.lodHidden && oldDepth > 1) {
            recordHit(farClipModelOnlyCounter, {
              refno,
              subjectRefno,
              annotationType,
              recordId: bareInputs[rIdx].id,
              detail: `oldFar=${modelOnlyPlanes.far}m, dist=${fitDistM.toFixed(1)}m`,
            });
          }
          if (!isLayoutVisibleOnScreen(fe, lNew) && !lNew.derived?.lodHidden && newDepth > 1) {
            recordHit(farClipFixedCounter, {
              refno,
              subjectRefno,
              annotationType,
              recordId: bareInputs[rIdx].id,
              detail: `newFar=${fixedPlanes.far}m`,
            });
          }
        }
      }

      const companionMap = findCompanionParentMap(payload);

      // Package-level views: default isometric, front fit, mid zoom, plus isoline mid-views if companion exists
      const pkgPoses = [
        { name: 'default-iso', center, dist: fitDistM, dir: [1, 1, 0.8] },
        { name: 'fit-front', center, dist: fitDistM * 0.95, dir: [0, -0.7, 0.7] },
        { name: 'mid-zoom', center, dist: Math.max(fixedPlanes.near * 2, fitDistM * 0.45), dir: [1, 1, 0.8] },
      ];
      if (companionMap.size > 0 && Array.isArray(payload.meta.isolines)) {
        for (const iso of payload.meta.isolines) {
          if (!iso.axis) continue;
          const a = iso.axis.from.map(v => v * 0.001);
          const b = iso.axis.to.map(v => v * 0.001);
          const isoCenter = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
          const isoLen = Math.max(0.2, dist3(a, b));
          const isoDist = Math.max(fixedPlanes.near * 2, (isoLen / 2 / Math.sin((fovDeg * Math.PI) / 360)) * 1.15);
          pkgPoses.push({ name: `isoline-${iso.index}`, center: isoCenter, dist: isoDist, dir: [1, 1, 0.8] });
          pkgPoses.push({ name: `isoline-${iso.index}-side`, center: isoCenter, dist: isoDist, dir: [0.3, -1, 0.5] });
        }
      }

      const everDrawn = new Array(inputs.length).fill(false);
      const orphanReported = new Set();

      for (const pose of pkgPoses) {
        const proj = makeProjector(fe, pose.center, pose.dist, pose.dir, fixedPlanes, fovDeg);
        const batch = fe.layoutViewport(
          inputs,
          { projector: proj, font: fe.font, theme: fe.theme, format: fe.format },
          new Map(),
        );
        const layoutById = new Map();
        for (let rIdx = 0; rIdx < inputs.length; rIdx += 1) {
          const l = batch.layouts[rIdx];
          layoutById.set(l.dimensionId, l);
          if (isLayoutVisibleOnScreen(fe, l)) everDrawn[rIdx] = true;
        }
        for (const [compId, info] of companionMap.entries()) {
          if (orphanReported.has(compId)) continue;
          const compLayout = layoutById.get(compId);
          const hostLayout = layoutById.get(info.hostId);
          if (
            compLayout
            && hostLayout
            && isLayoutVisibleOnScreen(fe, compLayout)
            && !isLayoutVisibleOnScreen(fe, hostLayout)
            && hostLayout.derived?.lodHidden === 'overlap'
          ) {
            orphanReported.add(compId);
            recordHit(orphanCompanionCounter, {
              refno,
              subjectRefno,
              annotationType,
              recordId: compId,
              detail: `${info.kind} 在 ${pose.name} 机位孤立残留（主尺寸 ${info.hostId} 因 overlap 隐藏）`,
            });
          }
        }
      }

      // Per-record close-up focus for any record not yet drawn in package-level views (or watched samples)
      const closeDists = [
        fixedPlanes.near * 1.08,
        fixedPlanes.near * 1.8,
        fixedPlanes.near * 4.0,
        fixedPlanes.near * 10.0,
      ];
      const baseDirs = [
        [1, 1, 0.8],
        [0, -0.25, 1],
        [1, -0.2, 0.25],
      ];

      const watchLog = WATCH_SAMPLES.has(refno) ? { refno, type: annotationType, total: inputs.length, neverDrawn: [], faceOnAngles: [] } : null;

      const declutterPeers = inputs.filter(
        inp => 'lines' in inp && (inp.dimension3d !== undefined || inp.declutter !== undefined),
      );
      const peerFocusPts = declutterPeers.map(peer => recordFocusPoint(peer));

      // Special check on watched pipe angle samples (e.g. 24381_103704 face-on along arc normal):
      if (watchLog) {
        const angleInputs = inputs.filter(inp => 'arcs' in inp && inp.arcs && inp.arcs.length > 0 && inp.declutter);
        for (const ang of angleInputs) {
          const arc = ang.arcs[0];
          const normalDir = arc.normal;
          const focusPt = ang.labelAnchor;
          const radius = Math.max(0.6, fixedPlanes.near * 8);
          const nearby = declutterPeers.filter((_, pIdx) => dist3(peerFocusPts[pIdx], focusPt) <= radius);
          const proj = makeProjector(fe, focusPt, fixedPlanes.near * 3.0, normalDir, fixedPlanes, fovDeg);
          const batch = fe.layoutViewport(
            nearby,
            { projector: proj, font: fe.font, theme: fe.theme, format: fe.format },
            new Map(),
          );
          const l = batch.layouts.find(x => x.dimensionId === ang.id);
          if (!l || !isLayoutVisibleOnScreen(fe, l)) {
            watchLog.faceOnAngles.push({ id: ang.id, text: ang.formattedLabel, reason: l?.derived?.lodHidden ?? 'clipped' });
          }
        }
      }

      for (let rIdx = 0; rIdx < inputs.length; rIdx += 1) {
        if (everDrawn[rIdx]) continue;
        const targetInput = inputs[rIdx];
        const focusPt = recordFocusPoint(targetInput);
        const joinsDeclutter = 'lines' in targetInput
          && (targetInput.dimension3d !== undefined || targetInput.declutter !== undefined);
        const dirs = [...baseDirs];
        if ('arcs' in targetInput && targetInput.arcs?.[0]?.normal) {
          dirs.push(targetInput.arcs[0].normal);
        }

        const reasons = new Set();
        let drawnOnCloseUp = false;
        for (const dist of closeDists) {
          let nearbyPeers = null;
          for (const dir of dirs) {
            const proj = makeProjector(fe, focusPt, dist, dir, fixedPlanes, fovDeg);
            const solo = fe.layoutViewport(
              [targetInput],
              { projector: proj, font: fe.font, theme: fe.theme, format: fe.format },
              new Map(),
            ).layouts[0];
            if (!solo || !isLayoutVisibleOnScreen(fe, solo)) {
              if (solo?.derived?.lodHidden) reasons.add(solo.derived.lodHidden);
              else reasons.add('clipped');
              continue;
            }
            if (!joinsDeclutter) {
              drawnOnCloseUp = true;
              break;
            }
            if (nearbyPeers === null) {
              const cutoffM = Math.max(0.5, dist * 2.5);
              nearbyPeers = declutterPeers.filter((_, pIdx) => dist3(peerFocusPts[pIdx], focusPt) <= cutoffM);
            }
            if (nearbyPeers.length <= 1) {
              drawnOnCloseUp = true;
              break;
            }
            const batch = fe.layoutViewport(
              nearbyPeers,
              { projector: proj, font: fe.font, theme: fe.theme, format: fe.format },
              new Map(),
            );
            const l = batch.layouts.find(x => x.dimensionId === targetInput.id);
            if (l && isLayoutVisibleOnScreen(fe, l)) {
              drawnOnCloseUp = true;
              break;
            }
            if (l?.derived?.lodHidden) reasons.add(l.derived.lodHidden);
            else reasons.add('clipped');
          }
          if (drawnOnCloseUp) break;
        }

        if (!drawnOnCloseUp) {
          const rList = [...reasons];
          if (watchLog) {
            watchLog.neverDrawn.push({ id: targetInput.id, text: targetInput.formattedLabel, reasons: rList });
          }
          if (reasons.has('detail-far') || reasons.has('secondary-far')) {
            recordHit(tinyTextNearCounter, {
              refno,
              subjectRefno,
              annotationType,
              recordId: targetInput.id,
              detail: `h=${((targetInput.textHeightM ?? 0) * 1000).toFixed(3)}mm`,
            });
          } else if (reasons.has('overlap')) {
            recordHit(overlapCounter, {
              refno,
              subjectRefno,
              annotationType,
              recordId: targetInput.id,
              detail: `text="${targetInput.formattedLabel}"`,
            });
          } else if (reasons.has('short-line')) {
            recordHit(shortLineCloseUpCounter, {
              refno,
              subjectRefno,
              annotationType,
              recordId: targetInput.id,
              detail: `text="${targetInput.formattedLabel}", h=${((targetInput.textHeightM ?? 0) * 1000).toFixed(3)}mm`,
            });
          }
        }
      }

      if (watchLog) {
        watchedDetails[refno] = {
          ...watchLog,
          orphanCompanions: [...orphanReported],
          modelOnlyPlanes,
          fixedPlanes,
        };
      }

      if ((idx + 1) % 1500 === 0) {
        process.stderr.write(`[mbd-140-audit] ${idx + 1}/${files.length}\n`);
      }
    }

    const formatCounter = c => ({
      records: c.recordCount,
      candidateObjects: c.candidateObjects.size,
      subjectObjects: c.subjectObjects.size,
      byType: Object.fromEntries(
        Object.entries(c.byType).map(([k, v]) => [
          k,
          { records: v.records, subjects: v.subjects.size, samples: v.samples },
        ]),
      ),
      samples: c.samples,
    });

    const summary = {
      scannedAt: new Date().toISOString(),
      elapsedSec: +((Date.now() - startedAt) / 1000).toFixed(1),
      okCandidatePackages: okPackages,
      okSubjectObjects: okSubjects.size,
      totalMappedRecords: totalRecords,
      categories: {
        overlapAllPoses: formatCounter(overlapCounter),
        orphanCompanionNotes: formatCounter(orphanCompanionCounter),
        farPlaneClippedBeforeFix139: formatCounter(farClipModelOnlyCounter),
        farPlaneClippedAfterFix139: formatCounter(farClipFixedCounter),
        tinyTextBlockedByNearPlane: formatCounter(tinyTextNearCounter),
        shortLineBlockedByNearPlane: formatCounter(shortLineCloseUpCounter),
      },
      watchedSamples: watchedDetails,
    };

    if (outJson) {
      mkdirSync(path.dirname(outJson), { recursive: true });
      writeFileSync(outJson, JSON.stringify(summary, null, 2), 'utf8');
    }
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await fe.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
