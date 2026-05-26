/**
 * BRAN ↔ BRAN 自动水平距离标注 · 调试沙盒
 *
 * 入口：访问 /pipe-distance-sandbox.html
 *
 * 目的：
 *  - 不依赖后端，用合成 segments 直接驱动 detectPipeClearances
 *  - 用 LinearDimension3D 把每条 clearance 以颜色梯度（critical/warning/safe）渲染到 viewer
 *  - 内置 6 个典型 fixture（平行 / pipe rack / 贴合 / finite 段错位 / 微夹角 / 90° 交叉）
 *  - UI 可切 fixture、调 maxDistance / maxAngle、显示/隐藏标注与轴线辅助
 *
 * 与生产侧关系：
 *  - 算法 = src/utils/three/geometry/clearance/detectPipeClearances
 *  - 渲染 = src/utils/three/annotation/LinearDimension3D
 *  - severity = src/composables/pipeDistanceSeverity
 *  生产抽屉 PipeDistanceDrawer.vue 走的是 store + getMbdPipeAnnotations + usePipeDistanceAnnotationThree 链路；
 *  本沙盒直接绕过 store，方便复现/调试纯算法+渲染问题。
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import type { MbdPipeSegmentDto } from '@/api/mbdPipeApi';

import {
  resolvePipeDistanceSeverity,
  resolvePipeDistanceSeverityVisuals,
} from '@/composables/pipeDistanceSeverity';
import {
  AnnotationMaterials,
  LinearDimension3D,
} from '@/utils/three/annotation';
import { detectPipeClearances } from '@/utils/three/geometry/clearance/detectPipeClearances';

declare global {
  interface Window {
    __pipeDistanceSandboxReady?: boolean;
    __pipeDistanceSandbox?: {
      run: () => void;
      setFixture: (id: string) => void;
      fixtureIds: () => string[];
    };
  }
}

// ─── Fixture 定义 ─────────────────────────────────────────────────────────────

type Fixture = {
  id: string;
  title: string;
  desc: string;
  /** 多根 BRAN，每根至少 1 段 STRA segment */
  branches: Record<string, MbdPipeSegmentDto[]>;
  /** 相机焦点（mm） */
  cameraTarget: [number, number, number];
  /** 相机离 target 的距离（mm） */
  cameraDistance: number;
};

function makeStra(
  branRefno: string,
  segIdx: number,
  arrive: [number, number, number],
  leave: [number, number, number],
  outsideDiameter: number,
): MbdPipeSegmentDto {
  const dx = leave[0] - arrive[0];
  const dy = leave[1] - arrive[1];
  const dz = leave[2] - arrive[2];
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return {
    id: `${branRefno}-S${segIdx}`,
    refno: `${branRefno}-PIPE-${segIdx}`,
    noun: 'STRA',
    arrive,
    leave,
    length,
    straight_length: length,
    outside_diameter: outsideDiameter,
    bore: Math.max(0, outsideDiameter - 14),
  };
}

const FIXTURES: Fixture[] = [
  {
    id: 'A_two_parallel',
    title: 'A · 两根平行 X 方向（基础）',
    desc: 'BRAN-A1 (OD 168.3) ↔ BRAN-A2 (OD 114.3)，中心距 400mm。预期：1 条 clearance ≈ 258.7mm（warning 橙）。',
    branches: {
      'BRAN-A1': [makeStra('BRAN-A1', 1, [0, 0, 0], [3000, 0, 0], 168.3)],
      'BRAN-A2': [makeStra('BRAN-A2', 1, [0, 400, 0], [3000, 400, 0], 114.3)],
    },
    cameraTarget: [1500, 200, 0],
    cameraDistance: 4500,
  },
  {
    id: 'B_pipe_rack',
    title: 'B · 三根 pipe rack（密集 + 多对）',
    desc:
      '三根等径平行管沿 Z 走，X 间距分别 260/260mm。预期：3 个 pair——B1-B2 ≈92mm(危险红), B2-B3 ≈92mm(危险红), B1-B3 ≈352mm(提示黄, 需把 maxDistance 拉到 ≥360 才显示)。',
    branches: {
      'BRAN-B1': [makeStra('BRAN-B1', 1, [0, 0, 0], [0, 0, 3000], 168.3)],
      'BRAN-B2': [makeStra('BRAN-B2', 1, [260, 0, 0], [260, 0, 3000], 168.3)],
      'BRAN-B3': [makeStra('BRAN-B3', 1, [520, 0, 0], [520, 0, 3000], 168.3)],
    },
    cameraTarget: [260, 0, 1500],
    cameraDistance: 4500,
  },
  {
    id: 'C_zero_clearance',
    title: 'C · 贴合（净距 0）',
    desc: '两根 OD 200 管中心距 200mm（外表面正好贴合）。预期：1 条 clearance = 0mm（critical 红橙），算法 clamp 到 0 不返回负值。',
    branches: {
      'BRAN-C1': [makeStra('BRAN-C1', 1, [0, 0, 0], [2000, 0, 0], 200)],
      'BRAN-C2': [makeStra('BRAN-C2', 1, [0, 200, 0], [2000, 200, 0], 200)],
    },
    cameraTarget: [1000, 100, 0],
    cameraDistance: 3500,
  },
  {
    id: 'D_offset_finite',
    title: 'D · finite 段错位（覆盖远段过滤）',
    desc:
      'D1[0..2000], D2[1500..3500] 偏 300mm；D3[5000..7000] 远离。预期：仅 D1-D2 在重叠区报 ≈200mm warning；D1-D3、D2-D3 因 finite segment 最近点对距离过大不报。',
    branches: {
      'BRAN-D1': [makeStra('BRAN-D1', 1, [0, 0, 0], [2000, 0, 0], 100)],
      'BRAN-D2': [makeStra('BRAN-D2', 1, [1500, 300, 0], [3500, 300, 0], 100)],
      'BRAN-D3': [makeStra('BRAN-D3', 1, [5000, 300, 0], [7000, 300, 0], 100)],
    },
    cameraTarget: [3000, 150, 0],
    cameraDistance: 6500,
  },
  {
    id: 'E_micro_angle',
    title: 'E · 微夹角 3°',
    desc:
      'E1 沿 X 直线；E2 端点抬高 160mm，夹角 ≈ 3.05°。默认 maxAngle=5° 通过；改 maxAngle=2° 应过滤为 0。',
    branches: {
      'BRAN-E1': [makeStra('BRAN-E1', 1, [0, 0, 0], [3000, 0, 0], 100)],
      'BRAN-E2': [makeStra('BRAN-E2', 1, [0, 300, 0], [3000, 460, 0], 100)],
    },
    cameraTarget: [1500, 250, 0],
    cameraDistance: 4200,
  },
  {
    id: 'F_perpendicular',
    title: 'F · 90° 交叉（不应检测）',
    desc: 'F1 水平 X；F2 垂直 Y。夹角 90° 远超 maxAngle。预期：0 个 clearance（验证早退分支）。',
    branches: {
      'BRAN-F1': [makeStra('BRAN-F1', 1, [0, 0, 0], [3000, 0, 0], 100)],
      'BRAN-F2': [makeStra('BRAN-F2', 1, [1500, -1000, 0], [1500, 1000, 0], 100)],
    },
    cameraTarget: [1500, 0, 0],
    cameraDistance: 4200,
  },
];

// ─── DOM ──────────────────────────────────────────────────────────────────────

const statusEl = document.getElementById('status')!;
const fixtureSelect = document.getElementById('fixture-select') as HTMLSelectElement;
const maxDistanceInput = document.getElementById('max-distance') as HTMLInputElement;
const maxAngleInput = document.getElementById('max-angle') as HTMLInputElement;
const showAnnotationsInput = document.getElementById('show-annotations') as HTMLInputElement;
const showAxisInput = document.getElementById('show-axis') as HTMLInputElement;
const rerunBtn = document.getElementById('rerun') as HTMLButtonElement;
const fixtureDescEl = document.getElementById('fixture-desc')!;
const resultsBodyEl = document.getElementById('results-body')!;
const canvas = document.getElementById('canvas') as HTMLCanvasElement;

function setStatus(msg: string): void {
  statusEl.textContent = msg;
   
  console.log('[pipe-distance-sandbox]', msg);
}

// 初始化下拉
for (const f of FIXTURES) {
  const opt = document.createElement('option');
  opt.value = f.id;
  opt.textContent = f.title;
  fixtureSelect.appendChild(opt);
}

// ─── Scene ────────────────────────────────────────────────────────────────────

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1020);
scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const dl = new THREE.DirectionalLight(0xffffff, 0.85);
dl.position.set(3000, 5000, 4000);
scene.add(dl);

const grid = new THREE.GridHelper(8000, 32, 0x1f2937, 0x1a1a2e);
grid.position.y = -200;
scene.add(grid);

const axesHelper = new THREE.AxesHelper(800);
scene.add(axesHelper);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100000);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.max(1, window.devicePixelRatio || 1));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.1;

const materials = new AnnotationMaterials();

// 颜色板：每根 BRAN 一个色，从下面 hash 取，便于视觉区分
const BRAN_COLORS = [0x38bdf8, 0xa3e635, 0xf472b6, 0xfbbf24, 0xc084fc, 0x60a5fa, 0xfb7185];

// ─── 场景内动态对象 ───────────────────────────────────────────────────────────

const sceneObjects = {
  pipes: [] as THREE.Object3D[],
  axes: [] as THREE.Object3D[],
  annotations: [] as LinearDimension3D[],
};

function clearScene(): void {
  for (const o of sceneObjects.pipes) scene.remove(o);
  sceneObjects.pipes.length = 0;
  for (const o of sceneObjects.axes) scene.remove(o);
  sceneObjects.axes.length = 0;
  for (const a of sceneObjects.annotations) {
    scene.remove(a);
    a.dispose();
  }
  sceneObjects.annotations.length = 0;
}

function colorForBran(idx: number): number {
  return BRAN_COLORS[idx % BRAN_COLORS.length]!;
}

function buildPipeMesh(seg: MbdPipeSegmentDto, color: number): THREE.Mesh {
  const a = new THREE.Vector3(...(seg.arrive as [number, number, number]));
  const b = new THREE.Vector3(...(seg.leave as [number, number, number]));
  const axis = b.clone().sub(a);
  const length = axis.length();
  const radius = (seg.outside_diameter ?? 100) / 2;

  const geom = new THREE.CylinderGeometry(radius, radius, length, 28, 1, false);
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.45,
    metalness: 0.3,
    transparent: true,
    opacity: 0.78,
  });
  const mesh = new THREE.Mesh(geom, mat);

  // Cylinder 默认沿 Y 轴生成，需对齐到 axis 方向
  const up = new THREE.Vector3(0, 1, 0);
  const dir = axis.clone().normalize();
  mesh.quaternion.setFromUnitVectors(up, dir);
  mesh.position.copy(a.clone().lerp(b, 0.5));

  return mesh;
}

function buildAxisLine(seg: MbdPipeSegmentDto, color: number): THREE.Line {
  const a = new THREE.Vector3(...(seg.arrive as [number, number, number]));
  const b = new THREE.Vector3(...(seg.leave as [number, number, number]));
  const geom = new THREE.BufferGeometry().setFromPoints([a, b]);
  const mat = new THREE.LineDashedMaterial({ color, dashSize: 80, gapSize: 40, linewidth: 1 });
  const line = new THREE.Line(geom, mat);
  line.computeLineDistances();
  return line;
}

function buildLabelText(refnoA: string, refnoB: string, distMm: number): string {
  return `${Math.round(distMm)}mm  (${refnoA.split('-').slice(-1)[0]}↔${refnoB.split('-').slice(-1)[0]})`;
}

// ─── 单次场景渲染（pipes + clearances + 标注） ──────────────────────────────

let currentFixture: Fixture = FIXTURES[0]!;

function flyToFixture(f: Fixture): void {
  const target = new THREE.Vector3(...f.cameraTarget);
  controls.target.copy(target);
  const off = new THREE.Vector3(f.cameraDistance * 0.7, f.cameraDistance * 0.55, f.cameraDistance * 0.7);
  camera.position.copy(target.clone().add(off));
  camera.lookAt(target);
  camera.updateProjectionMatrix();
}

function renderFixture(): void {
  clearScene();

  const f = currentFixture;
  fixtureDescEl.innerHTML = `<div class="title">${f.title}</div><div>${f.desc}</div>`;

  // 1. 渲染所有 pipe + 可选轴线
  const branKeys = Object.keys(f.branches);
  branKeys.forEach((branKey, idx) => {
    const color = colorForBran(idx);
    const segs = f.branches[branKey]!;
    for (const seg of segs) {
      const m = buildPipeMesh(seg, color);
      scene.add(m);
      sceneObjects.pipes.push(m);

      if (showAxisInput.checked) {
        const ax = buildAxisLine(seg, color);
        scene.add(ax);
        sceneObjects.axes.push(ax);
      }
    }
  });

  // 2. 跑算法
  const maxDistance = Math.max(10, Math.min(3000, Number(maxDistanceInput.value) || 500));
  const maxAngle = Math.max(0, Math.min(20, Number(maxAngleInput.value) || 5));

  let clearances: ReturnType<typeof detectPipeClearances> = [];
  try {
    clearances = detectPipeClearances(f.branches, maxDistance, maxAngle);
  } catch (e) {
    setStatus(`[算法] detectPipeClearances 抛错：${e instanceof Error ? e.message : String(e)}`);
    renderResultList([]);
    return;
  }

  // 3. 渲染标注
  if (showAnnotationsInput.checked) {
    for (const c of clearances) {
      const dim = new LinearDimension3D(materials, {
        start: new THREE.Vector3(...c.start),
        end: new THREE.Vector3(...c.end),
        text: buildLabelText(c.pipe1_refno, c.pipe2_refno, c.distance),
        decimals: 0,
        unit: 'mm',
      });
      const severity = resolvePipeDistanceSeverity(c.distance);
      const visuals = resolvePipeDistanceSeverityVisuals(severity, materials);
      dim.setBackgroundColor(visuals.backgroundColor);
      dim.setMaterialSet(visuals.materialSet);
      scene.add(dim);
      sceneObjects.annotations.push(dim);
    }
  }

  // 4. 列表
  renderResultList(clearances);

  setStatus(
    `fixture=${f.id} · ${branKeys.length} 根 BRAN · ${clearances.length} 条 clearance · maxDistance=${maxDistance}mm · maxAngle=${maxAngle}°`,
  );
}

function renderResultList(clearances: ReturnType<typeof detectPipeClearances>): void {
  if (clearances.length === 0) {
    resultsBodyEl.innerHTML = '<div class="empty">无满足条件的 clearance</div>';
    return;
  }
  const rows = clearances
    .slice()
    .sort((a, b) => a.distance - b.distance)
    .map((c) => {
      const sev = resolvePipeDistanceSeverity(c.distance);
      const color = sev === 'critical' ? '#ef4444' : sev === 'warning' ? '#f97316' : '#fbbf24';
      const dist = Math.round(c.distance);
      const short = (s: string): string => s.split('-').slice(-2).join('-');
      return `<div class="row">
        <span class="dist" style="color:${color}">${dist}mm</span>
        <span class="pair">${short(c.pipe1_refno)}↔${short(c.pipe2_refno)}</span>
      </div>`;
    })
    .join('');
  resultsBodyEl.innerHTML = rows;
}

// ─── Resize / 渲染循环 ───────────────────────────────────────────────────────

function resize(): void {
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || (window.innerHeight - 60);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  materials.setResolution(w, h);
}
window.addEventListener('resize', resize);

function tick(): void {
  controls.update();
  for (const a of sceneObjects.annotations) a.update(camera);
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

// ─── 事件绑定 ────────────────────────────────────────────────────────────────

function switchFixture(id: string): void {
  const next = FIXTURES.find((f) => f.id === id);
  if (!next) return;
  currentFixture = next;
  fixtureSelect.value = id;
  flyToFixture(next);
  renderFixture();
}

fixtureSelect.addEventListener('change', () => switchFixture(fixtureSelect.value));
maxDistanceInput.addEventListener('change', renderFixture);
maxAngleInput.addEventListener('change', renderFixture);
showAnnotationsInput.addEventListener('change', renderFixture);
showAxisInput.addEventListener('change', renderFixture);
rerunBtn.addEventListener('click', renderFixture);

// 暴露到 window，便于浏览器 console / E2E 调试
window.__pipeDistanceSandbox = {
  run: renderFixture,
  setFixture: switchFixture,
  fixtureIds: () => FIXTURES.map((f) => f.id),
};

// ─── 启动 ────────────────────────────────────────────────────────────────────

resize();
switchFixture(FIXTURES[0]!.id);
requestAnimationFrame(tick);
window.__pipeDistanceSandboxReady = true;
setStatus('就绪');
