/**
 * 钢筋梁尺寸标注演示（复刻 RebarViz 效果）
 *
 * 展示混凝土梁 + 钢筋 + 三维尺寸标注
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import type { AnnotationMaterialSet } from '@/utils/three/annotation/core/AnnotationMaterials';

import {
  AnnotationMaterials,
  LinearDimension3D,
} from '@/utils/three/annotation';

declare global {
  interface Window {
    __rebarBeamDemoReady?: boolean;
  }
}

const status = document.getElementById('status')!;

function setStatus(msg: string): void {
  status.textContent = msg;
  console.log('[rebar-demo]', msg);
}

type ViewPresetName = 'front' | 'side' | 'top' | 'persp' | 'match';

async function main(): Promise<void> {
  setStatus('初始化场景...');

  const container = document.getElementById('canvas-container')!;
  const width = container.clientWidth;
  const height = container.clientHeight;

  // 场景
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);

  // 相机
  const camera = new THREE.PerspectiveCamera(38, width / height, 1, 12000);
  camera.position.set(-860, 760, 4580);
  camera.lookAt(220, -24, -40);

  // 渲染器（部分 CI/远程环境可能不支持 WebGL，这里做降级提示避免页面崩溃）
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);
  } catch (error) {
    console.error('[rebar-demo] WebGL 初始化失败', error);
    setStatus('当前环境不支持 WebGL，无法渲染演示场景。');
    window.__rebarBeamDemoReady = true;
    return;
  }

  // 控制器
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.target.set(220, -24, -40);

  // 灯光
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(1000, 2000, 1000);
  scene.add(dirLight);

  // 网格
  const gridHelper = new THREE.GridHelper(8000, 40, 0xc9c9c9, 0xe4e4e4);
  gridHelper.position.y = -500;
  scene.add(gridHelper);

  // 标注材质
  const materials = new AnnotationMaterials();
  materials.setResolution(width, height);
  for (const set of [
    materials.blue,
    materials.orange,
    materials.black,
    materials.ssDimensionDefault,
    materials.ssSelected,
  ]) {
    set.fatLine.linewidth = 1.8;
    set.fatLineHover.linewidth = 1.8;
  }

  // 统一标注样式参数（偏工程图）
  const dimStyle = {
    arrowStyle: 'open' as const,
    arrowSizePx: 11,
    arrowAngleDeg: 18,
    extensionOvershootPx: 10,
    labelRenderStyle: 'rebarviz' as const,
  };

  // ─── 梁参数（复刻目标图语义）─────────────────────────
  const beamWidth = 320;
  const beamHeight = 600;
  const beamLength = 4000;
  const supportWidth = 500;
  const cover = 25;
  const rebarDia = 25;
  const denseZoneLen = 1200;
  const lapLen = 150;
  const lnThird = Math.ceil(beamLength / 3);
  const anchorPart = 475;
  const fifteenD = 15 * rebarDia;

  const beamTop = beamHeight / 2;
  const beamBottom = -beamHeight / 2;
  const beamLeft = -beamLength / 2;
  const beamRight = beamLength / 2;
  const frontZ = beamWidth / 2 + 80;

  const beamGeom = new THREE.BoxGeometry(beamLength, beamHeight, beamWidth);
  const beamMat = new THREE.MeshStandardMaterial({
    color: 0xd5d7db,
    transparent: true,
    opacity: 0.58,
    roughness: 0.8,
    metalness: 0.1,
  });
  const beam = new THREE.Mesh(beamGeom, beamMat);
  beam.position.set(0, 0, 0);
  scene.add(beam);

  // 端部柱截面（用于 hc 标注）
  const supportMat = new THREE.MeshStandardMaterial({
    color: 0xaeb4bc,
    transparent: true,
    opacity: 0.33,
    roughness: 0.9,
    metalness: 0.05,
  });
  const supportGeom = new THREE.BoxGeometry(
    supportWidth,
    beamHeight + 40,
    beamWidth + 90,
  );
  const leftSupport = new THREE.Mesh(supportGeom, supportMat);
  leftSupport.position.set(beamLeft - supportWidth / 2, 0, 0);
  scene.add(leftSupport);
  const rightSupport = new THREE.Mesh(supportGeom, supportMat);
  rightSupport.position.set(beamRight + supportWidth / 2, 0, 0);
  scene.add(rightSupport);

  // ─── 钢筋模型 ─────────────────────────────────────
  const rebarRadius = rebarDia / 2;
  const mainRebarMat = new THREE.MeshStandardMaterial({
    color: 0x7d1515,
    roughness: 0.6,
    metalness: 0.4,
  });
  const supportRebarMat = new THREE.MeshStandardMaterial({
    color: 0x6e3cc7,
    roughness: 0.58,
    metalness: 0.38,
  });
  const stirrupMat = new THREE.LineBasicMaterial({
    color: 0x2f6a3f,
    transparent: true,
    opacity: 0.9,
  });
  const sideRebarMat = new THREE.MeshStandardMaterial({
    color: 0x234f8f,
    roughness: 0.6,
    metalness: 0.35,
  });

  const createLongitudinalBar = (
    y: number,
    z: number,
    material: THREE.Material,
    length = beamLength + 220,
  ): void => {
    const geom = new THREE.CylinderGeometry(
      rebarRadius,
      rebarRadius,
      length,
      16,
    );
    geom.rotateZ(Math.PI / 2);
    const rebar = new THREE.Mesh(geom, material);
    rebar.position.set(0, y, z);
    scene.add(rebar);
  };

  const topY = beamTop - cover - rebarRadius;
  const bottomY = beamBottom + cover + rebarRadius;
  const sideY = 0;
  const nearZ = beamWidth / 2 - cover - rebarRadius;
  const farZ = -nearZ;

  // 上部通长筋（2）
  createLongitudinalBar(topY, nearZ, mainRebarMat);
  createLongitudinalBar(topY, farZ, mainRebarMat);

  // 下部通长筋（4）
  createLongitudinalBar(bottomY, nearZ, mainRebarMat);
  createLongitudinalBar(bottomY, farZ, mainRebarMat);
  createLongitudinalBar(bottomY + rebarRadius * 2.1, nearZ, mainRebarMat);
  createLongitudinalBar(bottomY + rebarRadius * 2.1, farZ, mainRebarMat);

  // 侧面构造筋（2）
  createLongitudinalBar(sideY, nearZ, sideRebarMat, beamLength + 120);
  createLongitudinalBar(sideY, farZ, sideRebarMat, beamLength + 120);

  // 支座负筋（左右）
  createLongitudinalBar(topY + 25, nearZ - 16, supportRebarMat, lnThird + 450);
  createLongitudinalBar(topY + 25, farZ + 16, supportRebarMat, lnThird + 450);

  // 箍筋（加密区 100，非加密区 200）
  const stirrupHalfY = beamHeight / 2 - cover - rebarRadius;
  const stirrupHalfZ = beamWidth / 2 - cover - rebarRadius;
  const stirrupXs: number[] = [];
  let xCursor = beamLeft + 70;
  while (xCursor <= beamRight - 70) {
    stirrupXs.push(xCursor);
    const inDense =
      xCursor < beamLeft + denseZoneLen || xCursor > beamRight - denseZoneLen;
    xCursor += inDense ? 100 : 200;
  }
  for (const x of stirrupXs) {
    const points = [
      new THREE.Vector3(x, stirrupHalfY, stirrupHalfZ),
      new THREE.Vector3(x, stirrupHalfY, -stirrupHalfZ),
      new THREE.Vector3(x, -stirrupHalfY, -stirrupHalfZ),
      new THREE.Vector3(x, -stirrupHalfY, stirrupHalfZ),
      new THREE.Vector3(x, stirrupHalfY, stirrupHalfZ),
    ];
    const g = new THREE.BufferGeometry().setFromPoints(points);
    scene.add(new THREE.Line(g, stirrupMat));
  }

  // ─── 尺寸标注（语义化）──────────────────────────────
  const allAnnotations: LinearDimension3D[] = [];
  const addDim = (
    start: THREE.Vector3,
    end: THREE.Vector3,
    offset: number,
    direction: THREE.Vector3,
    text: string,
    materialSet: AnnotationMaterialSet,
    _labelColor: string,
    labelWorldOffset = new THREE.Vector3(0, 0, 0),
    labelT = 0.5,
  ): void => {
    const dim = new LinearDimension3D(
      materials,
      {
        start,
        end,
        offset,
        direction,
        text,
        labelT,
        labelOffsetWorld: labelWorldOffset,
        unit: '',
        decimals: 0,
        ...dimStyle,
      },
      { depthTest: false },
    );
    dim.setMaterialSet(materialSet);
    scene.add(dim);
    allAnnotations.push(dim);
  };

  // 主控尺寸（蓝）
  addDim(
    new THREE.Vector3(beamLeft, beamBottom + 70, frontZ),
    new THREE.Vector3(beamRight, beamBottom + 70, frontZ),
    180,
    new THREE.Vector3(0, -1, 0),
    `ln=${beamLength}mm`,
    materials.blue,
    '#3468d7',
    new THREE.Vector3(0, -32, 0),
  );

  // 支座宽 hc（灰黑）
  addDim(
    new THREE.Vector3(beamLeft - supportWidth + 40, beamBottom + 20, frontZ),
    new THREE.Vector3(beamLeft + 40, beamBottom + 20, frontZ),
    110,
    new THREE.Vector3(0, -1, 0),
    `hc=${supportWidth}`,
    materials.black,
    '#66778f',
    new THREE.Vector3(0, -12, 0),
  );
  addDim(
    new THREE.Vector3(beamRight, beamBottom + 20, frontZ),
    new THREE.Vector3(beamRight + supportWidth, beamBottom + 20, frontZ),
    110,
    new THREE.Vector3(0, -1, 0),
    `hc=${supportWidth}`,
    materials.black,
    '#66778f',
    new THREE.Vector3(0, -12, 0),
  );

  // ln/3（紫）
  addDim(
    new THREE.Vector3(beamLeft, beamTop - 8, 0),
    new THREE.Vector3(beamLeft + lnThird, beamTop - 8, 0),
    210,
    new THREE.Vector3(0, 1, 0),
    `ln/3=${lnThird}`,
    materials.ssDimensionDefault,
    '#6c43c1',
    new THREE.Vector3(0, 26, 0),
  );
  addDim(
    new THREE.Vector3(beamRight - lnThird, beamTop - 8, 0),
    new THREE.Vector3(beamRight - 90, beamTop - 8, 0),
    210,
    new THREE.Vector3(0, 1, 0),
    `ln/3=${lnThird}`,
    materials.ssDimensionDefault,
    '#6c43c1',
    new THREE.Vector3(0, 26, 0),
  );

  // 加密区（橙）
  addDim(
    new THREE.Vector3(beamLeft, beamTop + 24, 28),
    new THREE.Vector3(beamLeft + denseZoneLen, beamTop + 24, 28),
    310,
    new THREE.Vector3(0, 1, 0),
    `加密区 ${denseZoneLen}`,
    materials.orange,
    '#bc7c2c',
    new THREE.Vector3(0, 36, 0),
  );
  addDim(
    new THREE.Vector3(beamRight - denseZoneLen, beamTop + 24, 28),
    new THREE.Vector3(beamRight - 90, beamTop + 24, 28),
    310,
    new THREE.Vector3(0, 1, 0),
    `加密区 ${denseZoneLen}`,
    materials.orange,
    '#bc7c2c',
    new THREE.Vector3(0, 36, 0),
  );

  // 搭接（橙）
  addDim(
    new THREE.Vector3(beamLeft, beamTop + 48, -20),
    new THREE.Vector3(beamLeft + lapLen, beamTop + 48, -20),
    390,
    new THREE.Vector3(0, 1, 0),
    `搭接${lapLen}mm(≥${lapLen})`,
    materials.orange,
    '#bc7c2c',
    new THREE.Vector3(0, 46, 0),
  );
  addDim(
    new THREE.Vector3(beamRight - 180, beamTop + 48, -20),
    new THREE.Vector3(beamRight - 30, beamTop + 48, -20),
    390,
    new THREE.Vector3(0, 1, 0),
    `搭接${lapLen}mm(≥${lapLen})`,
    materials.orange,
    '#bc7c2c',
    new THREE.Vector3(0, 46, 0),
  );

  // 左端支座负筋
  addDim(
    new THREE.Vector3(beamLeft + 42, topY + 20, beamWidth / 2 - 16),
    new THREE.Vector3(beamLeft + 500, topY + 20, beamWidth / 2 - 16),
    120,
    new THREE.Vector3(0, 1, 0),
    `支座筋弯锚 0.4laE=${anchorPart}`,
    materials.ssDimensionDefault,
    '#6c43c1',
    new THREE.Vector3(-26, 22, 0),
    0.35,
  );
  addDim(
    new THREE.Vector3(beamLeft + 35, topY + 10, beamWidth / 2 - 10),
    new THREE.Vector3(beamLeft + 35, topY + 10 - fifteenD, beamWidth / 2 - 10),
    120,
    new THREE.Vector3(-1, 0, 0),
    `15d=${fifteenD}`,
    materials.ssDimensionDefault,
    '#6c43c1',
    new THREE.Vector3(-18, 0, 0),
  );

  // 右端上/下部筋锚固
  addDim(
    new THREE.Vector3(beamRight - 560, topY + 30, beamWidth / 2 - 8),
    new THREE.Vector3(beamRight - 120, topY + 30, beamWidth / 2 - 8),
    120,
    new THREE.Vector3(0, 1, 0),
    `上部筋弯锚 0.4laE=${anchorPart}`,
    materials.ssSelected,
    '#c44646',
    new THREE.Vector3(-20, 20, 0),
    0.5,
  );
  addDim(
    new THREE.Vector3(beamRight - 560, bottomY + 25, beamWidth / 2 - 8),
    new THREE.Vector3(beamRight - 120, bottomY + 25, beamWidth / 2 - 8),
    120,
    new THREE.Vector3(0, -1, 0),
    `下部筋弯锚 0.4laE=${anchorPart}`,
    materials.ssSelected,
    '#c44646',
    new THREE.Vector3(-20, -20, 0),
    0.5,
  );
  addDim(
    new THREE.Vector3(beamRight - 118, topY + 22, beamWidth / 2 + 6),
    new THREE.Vector3(beamRight - 118, topY + 22 - fifteenD, beamWidth / 2 + 6),
    110,
    new THREE.Vector3(1, 0, 0),
    `15d=${fifteenD}`,
    materials.ssSelected,
    '#c44646',
    new THREE.Vector3(18, 0, 0),
  );
  addDim(
    new THREE.Vector3(beamRight - 6, beamTop, beamWidth / 2 + 12),
    new THREE.Vector3(beamRight - 6, beamBottom, beamWidth / 2 + 12),
    130,
    new THREE.Vector3(1, 0, 0),
    '15d=3h=600',
    materials.black,
    '#61708a',
    new THREE.Vector3(18, 0, 0),
  );

  // 保护层 c
  addDim(
    new THREE.Vector3(beamLeft + 85, beamTop, beamWidth / 2 - 26),
    new THREE.Vector3(beamLeft + 85, beamTop - cover, beamWidth / 2 - 26),
    88,
    new THREE.Vector3(-1, 0, 0),
    `c=${cover}`,
    materials.black,
    '#61708a',
    new THREE.Vector3(-12, 0, 0),
  );

  // 视角预设与透明度控制（复刻参考页交互）
  const viewPresets: Record<
    ViewPresetName,
    { pos: THREE.Vector3; target: THREE.Vector3 }
  > = {
    front: {
      pos: new THREE.Vector3(0, 380, 5200),
      target: new THREE.Vector3(0, -40, 0),
    },
    side: {
      pos: new THREE.Vector3(-5400, 560, 0),
      target: new THREE.Vector3(0, -20, 0),
    },
    top: {
      pos: new THREE.Vector3(-80, 4200, 0),
      target: new THREE.Vector3(0, -20, 0),
    },
    persp: {
      pos: new THREE.Vector3(-1280, 760, 3340),
      target: new THREE.Vector3(520, -30, -40),
    },
    match: {
      pos: new THREE.Vector3(-860, 760, 4580),
      target: new THREE.Vector3(220, -24, -40),
    },
  };

  const viewButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>('.view-btn[data-view]'),
  );
  const opacitySlider = document.getElementById(
    'opacity-slider',
  ) as HTMLInputElement | null;
  const concreteMats = [beamMat, supportMat];

  const applyPreset = (name: ViewPresetName): void => {
    const preset = viewPresets[name];
    camera.position.copy(preset.pos);
    controls.target.copy(preset.target);
    camera.lookAt(preset.target);
    controls.update();
    for (const btn of viewButtons) {
      btn.classList.toggle('active', btn.dataset.view === name);
    }
  };

  for (const btn of viewButtons) {
    btn.addEventListener('click', () => {
      const v = btn.dataset.view as ViewPresetName | undefined;
      if (!v || !(v in viewPresets)) return;
      applyPreset(v);
    });
  }

  applyPreset('match');

  if (opacitySlider) {
    opacitySlider.addEventListener('input', () => {
      const ratio = Math.max(
        0.2,
        Math.min(0.9, Number(opacitySlider.value) / 100),
      );
      for (const m of concreteMats) {
        m.opacity = ratio;
      }
    });
  }

  // 响应窗口大小变化
  function resize(): void {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(w, h);
    materials.setResolution(w, h);
  }
  resize();
  window.addEventListener('resize', resize);

  // 渲染循环
  let frame = 0;
  function tick(): void {
    controls.update();
    for (const a of allAnnotations) {
      a.update(camera);
    }
    renderer.render(scene, camera);
    frame++;
    if (frame === 1) {
      setStatus(
        `已渲染梁配筋语义标注 Demo：${allAnnotations.length} 条尺寸标注（ln / ln/3 / 加密区 / 搭接 / 锚固）`,
      );
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  window.__rebarBeamDemoReady = true;
}

main();
