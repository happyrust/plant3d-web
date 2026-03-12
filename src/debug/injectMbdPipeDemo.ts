/**
 * 在 DTX Viewer 中注入模拟 BRAN 管道几何体 + MBD 标注
 *
 * 用于 ?dtx_demo=mbd_pipe 模式，不依赖任何后端服务。
 * 管道使用 Three.js 基本体直接加入 scene，标注通过 useMbdPipeAnnotationThree.renderBranch() 渲染。
 */

import * as THREE from 'three';

import type { MbdPipeData } from '@/api/mbdPipeApi';
import type { DtxViewer } from '@/viewer/dtx/DtxViewer';

import branTestData from '@/fixtures/bran-test-data.json';

export type MbdPipeDemoCase = 'default' | 'rebarviz_beam' | 'bran_fixture'

export type MbdPipeDemoConfig = {
  key: MbdPipeDemoCase
  title: string
  geometry: (dtxViewer: DtxViewer) => THREE.Group
  data: MbdPipeData
  flyTo: (dtxViewer: DtxViewer) => void
}

/** 默认案例：模拟管道 L 形布局（单位 mm，与标注坐标一致） */
function injectDefaultMbdPipeDemoGeometry(dtxViewer: DtxViewer): THREE.Group {
  const group = new THREE.Group();
  group.name = 'mbd-pipe-demo-geometry-default';

  const pipeRadius = 50;
  const pipeMat = new THREE.MeshStandardMaterial({
    color: 0x0ea5e9,
    roughness: 0.4,
    metalness: 0.3,
    transparent: true,
    opacity: 0.75,
  });
  const elbowMat = new THREE.MeshStandardMaterial({
    color: 0x06b6d4,
    roughness: 0.5,
    metalness: 0.3,
  });
  const endpointGeom = new THREE.SphereGeometry(25, 12, 12);

  // 段1: (0,0,0) → (1000,0,0) 水平
  const seg1G = new THREE.CylinderGeometry(pipeRadius, pipeRadius, 1000, 24);
  seg1G.rotateZ(Math.PI / 2);
  const seg1 = new THREE.Mesh(seg1G, pipeMat);
  seg1.position.set(500, 0, 0);
  group.add(seg1);

  // 段2: (1000,0,0) → (1000,800,0) 竖直
  const seg2G = new THREE.CylinderGeometry(pipeRadius, pipeRadius, 800, 24);
  const seg2 = new THREE.Mesh(seg2G, pipeMat);
  seg2.position.set(1000, 400, 0);
  group.add(seg2);

  // 段3: (1000,800,0) → (2200,800,0) 水平
  const seg3G = new THREE.CylinderGeometry(pipeRadius, pipeRadius, 1200, 24);
  seg3G.rotateZ(Math.PI / 2);
  const seg3 = new THREE.Mesh(seg3G, pipeMat);
  seg3.position.set(1600, 800, 0);
  group.add(seg3);

  // 弯头
  const elbowG = new THREE.SphereGeometry(pipeRadius * 1.2, 16, 16);
  const e1 = new THREE.Mesh(elbowG, elbowMat);
  e1.position.set(1000, 0, 0);
  group.add(e1);
  const e2 = new THREE.Mesh(elbowG, elbowMat);
  e2.position.set(1000, 800, 0);
  group.add(e2);

  // 起点（绿）终点（红）
  const startM = new THREE.Mesh(endpointGeom, new THREE.MeshBasicMaterial({ color: 0x22c55e }));
  startM.position.set(0, 0, 0);
  group.add(startM);
  const endM = new THREE.Mesh(endpointGeom, new THREE.MeshBasicMaterial({ color: 0xef4444 }));
  endM.position.set(2200, 800, 0);
  group.add(endM);

  // 环境光 + 方向光（demo 自带，不影响已有灯光）
  group.add(new THREE.AmbientLight(0xffffff, 0.4));
  const dl = new THREE.DirectionalLight(0xffffff, 0.6);
  dl.position.set(3000, 5000, 4000);
  group.add(dl);

  dtxViewer.scene.add(group);
  return group;
}

/** 还原 RebarViz 梁标注节奏的对标案例（仍走我们自己的 3D 标注渲染链路） */
function injectRebarvizBeamDemoGeometry(dtxViewer: DtxViewer): THREE.Group {
  const group = new THREE.Group();
  group.name = 'mbd-pipe-demo-geometry-rebarviz-beam';

  const totalLength = 4000;
  // 包含一段极短段（120mm），用于验证箭头/文字在拥挤空间下的外置策略
  const segBreaks = [0, 600, 1600, 1720, 2800, totalLength];
  const pipeRadius = 48;

  const beamMat = new THREE.MeshStandardMaterial({
    color: 0x64748b,
    roughness: 0.55,
    metalness: 0.2,
    transparent: true,
    opacity: 0.78,
  });
  const rebarMat = new THREE.MeshStandardMaterial({
    color: 0xf97316,
    roughness: 0.35,
    metalness: 0.45,
  });
  const markerMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
  const endpointGeom = new THREE.SphereGeometry(22, 12, 12);

  for (let i = 0; i < segBreaks.length - 1; i += 1) {
    const a = segBreaks[i];
    const b = segBreaks[i + 1];
    const len = b - a;
    const segG = new THREE.CylinderGeometry(pipeRadius, pipeRadius, len, 24);
    segG.rotateZ(Math.PI / 2);
    const seg = new THREE.Mesh(segG, beamMat);
    seg.position.set((a + b) * 0.5, 0, 0);
    group.add(seg);
  }

  const barRadius = 8;
  const barOffsets = [
    [0, 65, 35],
    [0, -65, 35],
    [0, 65, -35],
    [0, -65, -35],
  ];
  for (const [, y, z] of barOffsets) {
    const barG = new THREE.CylinderGeometry(barRadius, barRadius, totalLength, 18);
    barG.rotateZ(Math.PI / 2);
    const bar = new THREE.Mesh(barG, rebarMat);
    bar.position.set(totalLength * 0.5, y, z);
    group.add(bar);
  }

  for (const x of segBreaks) {
    const marker = new THREE.Mesh(endpointGeom, markerMat);
    marker.position.set(x, 0, 0);
    group.add(marker);
  }

  group.add(new THREE.AmbientLight(0xffffff, 0.45));
  const dl = new THREE.DirectionalLight(0xffffff, 0.65);
  dl.position.set(3200, 4200, 3500);
  group.add(dl);

  dtxViewer.scene.add(group);
  return group;
}

/** BRAN 测试夹具案例：从 JSON 加载的全面测试数据 */
function injectBranFixtureGeometry(dtxViewer: DtxViewer): THREE.Group {
  const group = new THREE.Group();
  group.name = 'mbd-pipe-demo-geometry-bran-fixture';

  const pipeRadius = 84.15; // OD 168.3 / 2
  const pipeMat = new THREE.MeshStandardMaterial({
    color: 0x3b82f6,
    roughness: 0.45,
    metalness: 0.35,
    transparent: true,
    opacity: 0.8,
  });
  const elbowMat = new THREE.MeshStandardMaterial({
    color: 0x2563eb,
    roughness: 0.5,
    metalness: 0.3,
  });
  const endpointGeom = new THREE.SphereGeometry(25, 12, 12);

  // 根据 bran-test-data.json 的 segments 构建几何体
  // Segment 1: (0,0,0) → (800,0,0)
  const seg1G = new THREE.CylinderGeometry(pipeRadius, pipeRadius, 800, 24);
  seg1G.rotateZ(Math.PI / 2);
  const seg1 = new THREE.Mesh(seg1G, pipeMat);
  seg1.position.set(400, 0, 0);
  group.add(seg1);

  // Segment 2: (800,0,0) → (800,600,0)
  const seg2G = new THREE.CylinderGeometry(pipeRadius, pipeRadius, 600, 24);
  const seg2 = new THREE.Mesh(seg2G, pipeMat);
  seg2.position.set(800, 300, 0);
  group.add(seg2);

  // Segment 3: (800,600,0) → (1800,600,0)
  const seg3G = new THREE.CylinderGeometry(pipeRadius, pipeRadius, 1000, 24);
  seg3G.rotateZ(Math.PI / 2);
  const seg3 = new THREE.Mesh(seg3G, pipeMat);
  seg3.position.set(1300, 600, 0);
  group.add(seg3);

  // Segment 4: (1800,600,0) → (1950,600,0) - 短段
  const seg4G = new THREE.CylinderGeometry(pipeRadius, pipeRadius, 150, 24);
  seg4G.rotateZ(Math.PI / 2);
  const seg4 = new THREE.Mesh(seg4G, pipeMat);
  seg4.position.set(1875, 600, 0);
  group.add(seg4);

  // Segment 5: (1950,600,0) → (2850,600,0)
  const seg5G = new THREE.CylinderGeometry(pipeRadius, pipeRadius, 900, 24);
  seg5G.rotateZ(Math.PI / 2);
  const seg5 = new THREE.Mesh(seg5G, pipeMat);
  seg5.position.set(2400, 600, 0);
  group.add(seg5);

  // 弯头（在转折点）
  const elbowG = new THREE.SphereGeometry(pipeRadius * 1.3, 16, 16);
  const e1 = new THREE.Mesh(elbowG, elbowMat);
  e1.position.set(800, 0, 0);
  group.add(e1);
  const e2 = new THREE.Mesh(elbowG, elbowMat);
  e2.position.set(800, 600, 0);
  group.add(e2);

  // TEE 在中间位置
  const teeG = new THREE.BoxGeometry(pipeRadius * 2.5, pipeRadius * 2.5, pipeRadius * 2.5);
  const tee = new THREE.Mesh(teeG, elbowMat);
  tee.position.set(1400, 600, 0);
  group.add(tee);

  // 起点（绿）终点（红）
  const startM = new THREE.Mesh(endpointGeom, new THREE.MeshBasicMaterial({ color: 0x10b981 }));
  startM.position.set(0, 0, 0);
  group.add(startM);
  const endM = new THREE.Mesh(endpointGeom, new THREE.MeshBasicMaterial({ color: 0xef4444 }));
  endM.position.set(2850, 600, 0);
  group.add(endM);

  // 环境光 + 方向光
  group.add(new THREE.AmbientLight(0xffffff, 0.42));
  const dl = new THREE.DirectionalLight(0xffffff, 0.62);
  dl.position.set(3200, 4500, 4000);
  group.add(dl);

  dtxViewer.scene.add(group);
  return group;
}

/** 适配 renderBranch 的默认模拟 MBD 数据 */
export const demoMbdPipeData: MbdPipeData = {
  input_refno: 'DEMO-BRAN',
  branch_refno: 'DEMO-BRAN',
  branch_name: 'DEMO-BRAN-001',
  branch_attrs: { duty: 'DEMO', pspec: 'PS-DEMO', fluid: 'WATER' },
  segments: [
    { id: 'seg_1', refno: 'S:1', noun: 'STRA', arrive: [0, 0, 0], leave: [1000, 0, 0], length: 1000, straight_length: 1000, outside_diameter: 219.1, bore: 200 },
    { id: 'seg_2', refno: 'S:2', noun: 'STRA', arrive: [1000, 0, 0], leave: [1000, 800, 0], length: 800, straight_length: 800, outside_diameter: 219.1, bore: 200 },
    { id: 'seg_3', refno: 'S:3', noun: 'STRA', arrive: [1000, 800, 0], leave: [2200, 800, 0], length: 1200, straight_length: 1200, outside_diameter: 219.1, bore: 200 },
  ],
  dims: [
    // segment（绿）
    { id: 'd_s1', kind: 'segment', start: [0, 0, 0], end: [1000, 0, 0], length: 1000, text: '1000' },
    { id: 'd_s2', kind: 'segment', start: [1000, 0, 0], end: [1000, 800, 0], length: 800, text: '800' },
    { id: 'd_s3', kind: 'segment', start: [1000, 800, 0], end: [2200, 800, 0], length: 1200, text: '1200' },
    // chain（黄）
    { id: 'd_c1', kind: 'chain', group_id: 'g1', seq: 1, start: [0, 0, 0], end: [1000, 0, 0], length: 1000, text: '1000' },
    { id: 'd_c2', kind: 'chain', group_id: 'g1', seq: 2, start: [1000, 0, 0], end: [1000, 800, 0], length: 800, text: '800' },
    { id: 'd_c3', kind: 'chain', group_id: 'g1', seq: 3, start: [1000, 800, 0], end: [2200, 800, 0], length: 1200, text: '1200' },
    // overall（白）
    { id: 'd_o', kind: 'overall', start: [0, 0, 0], end: [2200, 800, 0], length: 3000, text: 'L=3000' },
    // port（蓝）
    { id: 'd_p', kind: 'port', start: [0, 0, 0], end: [1000, 0, 0], length: 1000, text: 'P1→P2' },
  ],
  welds: [
    { id: 'w1', position: [1000, 0, 0], weld_type: 'Butt', is_shop: false, label: 'W1', left_refno: 'S:1', right_refno: 'S:2' },
    { id: 'w2', position: [1000, 800, 0], weld_type: 'Butt', is_shop: true, label: 'W2', left_refno: 'S:2', right_refno: 'S:3' },
  ],
  slopes: [
    { id: 'sl1', start: [0, 0, 0], end: [1000, 0, 0], slope: 0.01, text: '1%' },
  ],
  bends: [],
  stats: { segments_count: 3, dims_count: 8, welds_count: 2, slopes_count: 1, bends_count: 0 },
  debug_info: { source: 'mock', notes: ['dtx_demo=mbd_pipe 模式'] },
};

export const demoMbdPipeRebarvizBeamData: MbdPipeData = {
  input_refno: 'DEMO-REBARVIZ-BEAM',
  branch_refno: 'DEMO-REBARVIZ-BEAM',
  branch_name: 'DEMO-REBARVIZ-BEAM-001',
  branch_attrs: { duty: 'DEMO', pspec: 'PS-BEAM', fluid: 'N/A' },
  segments: [
    { id: 'seg_b1', refno: 'B:1', noun: 'STRA', arrive: [0, 0, 0], leave: [600, 0, 0], length: 600, straight_length: 600, outside_diameter: 95, bore: 80 },
    { id: 'seg_b2', refno: 'B:2', noun: 'STRA', arrive: [600, 0, 0], leave: [1600, 0, 0], length: 1000, straight_length: 1000, outside_diameter: 95, bore: 80 },
    // 极短段：验证密集标注下箭头翻转/外置
    { id: 'seg_b3', refno: 'B:3', noun: 'STRA', arrive: [1600, 0, 0], leave: [1720, 0, 0], length: 120, straight_length: 120, outside_diameter: 95, bore: 80 },
    { id: 'seg_b4', refno: 'B:4', noun: 'STRA', arrive: [1720, 0, 0], leave: [2800, 0, 0], length: 1080, straight_length: 1080, outside_diameter: 95, bore: 80 },
    { id: 'seg_b5', refno: 'B:5', noun: 'STRA', arrive: [2800, 0, 0], leave: [4000, 0, 0], length: 1200, straight_length: 1200, outside_diameter: 95, bore: 80 },
  ],
  dims: [
    { id: 'd_bs1', kind: 'segment', start: [0, 0, 0], end: [600, 0, 0], length: 600, text: '600' },
    { id: 'd_bs2', kind: 'segment', start: [600, 0, 0], end: [1600, 0, 0], length: 1000, text: '1000' },
    { id: 'd_bs3', kind: 'segment', start: [1600, 0, 0], end: [1720, 0, 0], length: 120, text: '120' },
    { id: 'd_bs4', kind: 'segment', start: [1720, 0, 0], end: [2800, 0, 0], length: 1080, text: '1080' },
    { id: 'd_bs5', kind: 'segment', start: [2800, 0, 0], end: [4000, 0, 0], length: 1200, text: '1200' },
    { id: 'd_bc1', kind: 'chain', group_id: 'beam-chain', seq: 1, start: [0, 0, 0], end: [600, 0, 0], length: 600, text: '600' },
    { id: 'd_bc2', kind: 'chain', group_id: 'beam-chain', seq: 2, start: [600, 0, 0], end: [1600, 0, 0], length: 1000, text: '1000' },
    { id: 'd_bc3', kind: 'chain', group_id: 'beam-chain', seq: 3, start: [1600, 0, 0], end: [1720, 0, 0], length: 120, text: '120' },
    { id: 'd_bc4', kind: 'chain', group_id: 'beam-chain', seq: 4, start: [1720, 0, 0], end: [2800, 0, 0], length: 1080, text: '1080' },
    { id: 'd_bc5', kind: 'chain', group_id: 'beam-chain', seq: 5, start: [2800, 0, 0], end: [4000, 0, 0], length: 1200, text: '1200' },
    { id: 'd_bo', kind: 'overall', start: [0, 0, 0], end: [4000, 0, 0], length: 4000, text: 'L=4000' },
  ],
  welds: [],
  slopes: [],
  bends: [],
  stats: { segments_count: 5, dims_count: 11, welds_count: 0, slopes_count: 0, bends_count: 0 },
  debug_info: {
    source: 'mock',
    notes: [
      'dtx_demo=mbd_pipe 模式',
      'mbd_pipe_case=rebarviz_beam 对标 RebarViz 梁尺寸样式',
    ],
  },
};

/** 默认案例：将相机飞到管道位置 */
export function flyToPipeDemo(dtxViewer: DtxViewer): void {
  const center = new THREE.Vector3(1100, 400, 0);
  const distance = 3500;
  const position = new THREE.Vector3(
    center.x + distance * 0.7,
    center.y + distance * 0.5,
    center.z + distance * 0.7,
  );
  dtxViewer.flyTo(position, center, { duration: 0.5 });
}

function flyToRebarvizBeamDemo(dtxViewer: DtxViewer): void {
  const center = new THREE.Vector3(2000, 0, 0);
  // 适度拉近视角，便于在演示中观察箭头与短尺寸段外置效果
  const distance = 3600;
  const position = new THREE.Vector3(
    center.x + distance * 0.72,
    center.y + distance * 0.38,
    center.z + distance * 0.62,
  );
  dtxViewer.flyTo(position, center, { duration: 0.5 });
}

function flyToBranFixture(dtxViewer: DtxViewer): void {
  const center = new THREE.Vector3(1425, 300, 0);
  const distance = 4200;
  const position = new THREE.Vector3(
    center.x + distance * 0.68,
    center.y + distance * 0.42,
    center.z + distance * 0.65,
  );
  dtxViewer.flyTo(position, center, { duration: 0.5 });
}

/**
 * BRAN Fixture Camera Presets for SolveSpace Comparison Verification
 * 
 * These camera positions provide focused views for manual verification of dimension annotations.
 * Each preset emphasizes specific aspects documented in BRAN_SOLVESPACE_COMPARISON.md
 * 
 * Usage from browser console:
 *   branCameraPresets.normalSegments(window.dtxViewer)
 *   branCameraPresets.shortSegment(window.dtxViewer)
 *   branCameraPresets.chainRelationships(window.dtxViewer)
 *   branCameraPresets.arrowDetail(window.dtxViewer)
 *   branCameraPresets.overallView(window.dtxViewer)
 */
export const branCameraPresets = {
  /**
   * Preset 1: Normal Segment Dimensions
   * Focus: Extension overshoot, arrow V-lines, label centering
   * Segments: 1 (800mm horizontal) and 3 (1000mm horizontal)
   */
  normalSegments: (dtxViewer: DtxViewer) => {
    const center = new THREE.Vector3(900, 400, 0);
    const position = new THREE.Vector3(900, 900, 1800);
    dtxViewer.flyTo(position, center, { duration: 0.5 });
  },

  /**
   * Preset 2: Crowded Short Segment (150mm)
   * Focus: Arrow reversal, external label placement
   * Segment: 4 at (1800,600,0 → 1950,600,0)
   */
  shortSegment: (dtxViewer: DtxViewer) => {
    const center = new THREE.Vector3(1875, 600, 0);
    const position = new THREE.Vector3(1875, 1200, 1400);
    dtxViewer.flyTo(position, center, { duration: 0.5 });
  },

  /**
   * Preset 3: Chain Dimension Relationships
   * Focus: Stacked dimensions, visual hierarchy, offset consistency
   * View: Side angle showing all chain dimensions with segment/chain/overall layers
   */
  chainRelationships: (dtxViewer: DtxViewer) => {
    const center = new THREE.Vector3(1425, 300, 0);
    const position = new THREE.Vector3(1425, 1200, 2200);
    dtxViewer.flyTo(position, center, { duration: 0.5 });
  },

  /**
   * Preset 4: Arrow and Extension Line Detail
   * Focus: Arrow V-line structure, extension line perpendicularity, 10px overshoot
   * Segment: Close-up on first segment dimension
   */
  arrowDetail: (dtxViewer: DtxViewer) => {
    const center = new THREE.Vector3(400, 0, 0);
    const position = new THREE.Vector3(400, 500, 900);
    dtxViewer.flyTo(position, center, { duration: 0.5 });
  },

  /**
   * Preset 5: Overall View - All Annotations
   * Focus: Full scene with dimensions, welds, slopes, tags
   * View: Isometric showing entire branch
   */
  overallView: (dtxViewer: DtxViewer) => {
    const center = new THREE.Vector3(1425, 300, 0);
    const position = new THREE.Vector3(1425, 1800, 3200);
    dtxViewer.flyTo(position, center, { duration: 0.5 });
  },

  /**
   * Preset 6: Vertical Segment with Elbow
   * Focus: Dimension rendering on vertical pipe, elbow fitting
   * Segment: 2 at (800,0,0 → 800,600,0) with elbow at bottom
   */
  verticalSegment: (dtxViewer: DtxViewer) => {
    const center = new THREE.Vector3(800, 300, 0);
    const position = new THREE.Vector3(800, 300, 1400);
    dtxViewer.flyTo(position, center, { duration: 0.5 });
  },

  /**
   * Preset 7: TEE Fitting Area
   * Focus: TEE fitting tag, dimension alignment around fitting
   * Location: TEE at (1400,600,0) on segment 3
   */
  teeFitting: (dtxViewer: DtxViewer) => {
    const center = new THREE.Vector3(1400, 600, 0);
    const position = new THREE.Vector3(1400, 1100, 1600);
    dtxViewer.flyTo(position, center, { duration: 0.5 });
  },
};

export function resolveMbdPipeDemoCaseFromUrl(
  urlSearch = typeof window !== 'undefined' ? window.location.search : '',
): MbdPipeDemoCase {
  const q = new URLSearchParams(urlSearch);
  const raw = String(q.get('mbd_pipe_case') || q.get('mbd_case') || '')
    .trim()
    .toLowerCase();
  if (raw === 'rebarviz_beam' || raw === 'beam') return 'rebarviz_beam';
  if (raw === 'bran_fixture' || raw === 'fixture' || raw === 'test') return 'bran_fixture';
  return 'default';
}

export function getMbdPipeDemoConfig(caseKey: MbdPipeDemoCase): MbdPipeDemoConfig {
  if (caseKey === 'rebarviz_beam') {
    return {
      key: 'rebarviz_beam',
      title: 'RebarViz 梁标注对标案例',
      geometry: injectRebarvizBeamDemoGeometry,
      data: demoMbdPipeRebarvizBeamData,
      flyTo: flyToRebarvizBeamDemo,
    };
  }
  if (caseKey === 'bran_fixture') {
    return {
      key: 'bran_fixture',
      title: 'BRAN 测试夹具（JSON）',
      geometry: injectBranFixtureGeometry,
      data: branTestData as MbdPipeData,
      flyTo: flyToBranFixture,
    };
  }
  return {
    key: 'default',
    title: '默认 L 形管道案例',
    geometry: injectDefaultMbdPipeDemoGeometry,
    data: demoMbdPipeData,
    flyTo: flyToPipeDemo,
  };
}

/** 兼容旧调用：默认 L 形案例 */
export function injectMbdPipeDemoGeometry(dtxViewer: DtxViewer): THREE.Group {
  return injectDefaultMbdPipeDemoGeometry(dtxViewer);
}
