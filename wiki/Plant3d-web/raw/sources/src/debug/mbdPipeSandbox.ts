/**
 * MBD 管道尺寸标注沙盒（独立页面，不依赖后端/ViewerPanel）
 *
 * 展示 SolveSpace 风格的三维标注：
 * - LinearDimension3D（segment / chain / overall / port）
 * - WeldAnnotation3D
 * - SlopeAnnotation3D
 * - AngleDimension3D
 * - 模拟管道几何体（圆柱 + 弯头）
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import {
  AnnotationMaterials,
  LinearDimension3D,
  AngleDimension3D,
  WeldAnnotation3D,
  SlopeAnnotation3D,
} from '@/utils/three/annotation';

declare global {
  interface Window {
    __mbdPipeSandboxReady?: boolean
  }
}

const status = document.getElementById('status')!;

function setStatus(msg: string): void {
  status.textContent = msg;
  console.log('[mbd-sandbox]', msg);
}

function main(): void {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement | null;
  if (!canvas) {
    setStatus('canvas 不存在');
    window.__mbdPipeSandboxReady = true;
    return;
  }

  // ─── Scene ──────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1020);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 50000);
  camera.position.set(2500, 2000, 3500);
  camera.lookAt(1000, 500, 0);

  // lights
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(3000, 5000, 4000);
  scene.add(dirLight);

  // grid helper（辅助定位）
  const grid = new THREE.GridHelper(5000, 50, 0x1a1a2e, 0x1a1a2e);
  grid.position.y = -50;
  scene.add(grid);

  // ─── Materials ──────────────────────────────────────
  const materials = new AnnotationMaterials();

  // ─── 管道几何体 ─────────────────────────────────────
  // 管道布局（L 形）：
  //   段1: (0,0,0) → (1000,0,0)   水平向右
  //   段2: (1000,0,0) → (1000,800,0)   竖直向上
  //   段3: (1000,800,0) → (2200,800,0)  水平向右
  const pipeRadius = 50;
  const pipeMat = new THREE.MeshStandardMaterial({
    color: 0x0ea5e9,
    roughness: 0.4,
    metalness: 0.3,
    transparent: true,
    opacity: 0.7,
  });

  // 段1：水平管道
  const seg1Geom = new THREE.CylinderGeometry(pipeRadius, pipeRadius, 1000, 24);
  seg1Geom.rotateZ(Math.PI / 2); // 沿 X 方向
  const seg1 = new THREE.Mesh(seg1Geom, pipeMat);
  seg1.position.set(500, 0, 0);
  scene.add(seg1);

  // 段2：竖直管道
  const seg2Geom = new THREE.CylinderGeometry(pipeRadius, pipeRadius, 800, 24);
  const seg2 = new THREE.Mesh(seg2Geom, pipeMat);
  seg2.position.set(1000, 400, 0);
  scene.add(seg2);

  // 段3：水平管道
  const seg3Geom = new THREE.CylinderGeometry(pipeRadius, pipeRadius, 1200, 24);
  seg3Geom.rotateZ(Math.PI / 2);
  const seg3 = new THREE.Mesh(seg3Geom, pipeMat);
  seg3.position.set(1600, 800, 0);
  scene.add(seg3);

  // 弯头1：段1→段2 接头处球体
  const elbow1Geom = new THREE.SphereGeometry(pipeRadius * 1.2, 16, 16);
  const elbowMat = new THREE.MeshStandardMaterial({ color: 0x06b6d4, roughness: 0.5, metalness: 0.3 });
  const elbow1 = new THREE.Mesh(elbow1Geom, elbowMat);
  elbow1.position.set(1000, 0, 0);
  scene.add(elbow1);

  // 弯头2：段2→段3 接头处球体
  const elbow2 = new THREE.Mesh(elbow1Geom, elbowMat);
  elbow2.position.set(1000, 800, 0);
  scene.add(elbow2);

  // 起点/终点标记（小球）
  const endpointGeom = new THREE.SphereGeometry(30, 12, 12);
  const startMat = new THREE.MeshBasicMaterial({ color: 0x22c55e });
  const endMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
  const startSphere = new THREE.Mesh(endpointGeom, startMat);
  startSphere.position.set(0, 0, 0);
  scene.add(startSphere);
  const endSphere = new THREE.Mesh(endpointGeom, endMat);
  endSphere.position.set(2200, 800, 0);
  scene.add(endSphere);

  // ─── 尺寸标注 ───────────────────────────────────────

  // ** segment 类型（绿色）：每段长度 **
  const dimSeg1 = new LinearDimension3D(materials, {
    start: new THREE.Vector3(0, 0, 0),
    end: new THREE.Vector3(1000, 0, 0),
    offset: 200,
    text: '1000',
    direction: new THREE.Vector3(0, 0, 1),
  });
  dimSeg1.setMaterialSet(materials.green);
  scene.add(dimSeg1);

  const dimSeg2 = new LinearDimension3D(materials, {
    start: new THREE.Vector3(1000, 0, 0),
    end: new THREE.Vector3(1000, 800, 0),
    offset: 200,
    text: '800',
    direction: new THREE.Vector3(0, 0, 1),
  });
  dimSeg2.setMaterialSet(materials.green);
  scene.add(dimSeg2);

  const dimSeg3 = new LinearDimension3D(materials, {
    start: new THREE.Vector3(1000, 800, 0),
    end: new THREE.Vector3(2200, 800, 0),
    offset: 200,
    text: '1200',
    direction: new THREE.Vector3(0, 0, 1),
  });
  dimSeg3.setMaterialSet(materials.green);
  scene.add(dimSeg3);

  // ** chain 类型（黄色）：链式尺寸 **
  const dimChain1 = new LinearDimension3D(materials, {
    start: new THREE.Vector3(0, 0, 0),
    end: new THREE.Vector3(1000, 0, 0),
    offset: 400,
    text: '1000',
    direction: new THREE.Vector3(0, -1, 0),
  });
  dimChain1.setMaterialSet(materials.yellow);
  scene.add(dimChain1);

  const dimChain2 = new LinearDimension3D(materials, {
    start: new THREE.Vector3(1000, 0, 0),
    end: new THREE.Vector3(1000, 800, 0),
    offset: 400,
    text: '800',
    direction: new THREE.Vector3(-1, 0, 0),
  });
  dimChain2.setMaterialSet(materials.yellow);
  scene.add(dimChain2);

  const dimChain3 = new LinearDimension3D(materials, {
    start: new THREE.Vector3(1000, 800, 0),
    end: new THREE.Vector3(2200, 800, 0),
    offset: 400,
    text: '1200',
    direction: new THREE.Vector3(0, 1, 0),
  });
  dimChain3.setMaterialSet(materials.yellow);
  scene.add(dimChain3);

  // ** overall 类型（白色）：总长 **
  const dimOverall = new LinearDimension3D(materials, {
    start: new THREE.Vector3(0, 0, 0),
    end: new THREE.Vector3(2200, 800, 0),
    offset: 600,
    text: 'L=3000',
    direction: new THREE.Vector3(0, 0, 1),
  });
  dimOverall.setMaterialSet(materials.white);
  scene.add(dimOverall);

  // ** port 类型（蓝色）：端口间距 **
  const dimPort = new LinearDimension3D(materials, {
    start: new THREE.Vector3(0, 0, 0),
    end: new THREE.Vector3(1000, 0, 0),
    offset: -200,
    text: 'P1→P2: 1000',
    direction: new THREE.Vector3(0, 1, 0),
  });
  dimPort.setMaterialSet(materials.blue);
  scene.add(dimPort);

  // ─── 角度标注 ───────────────────────────────────────
  const angleDim = new AngleDimension3D(materials, {
    vertex: new THREE.Vector3(1000, 0, 0),
    point1: new THREE.Vector3(0, 0, 0),
    point2: new THREE.Vector3(1000, 800, 0),
    arcRadius: 300,
    decimals: 1,
  });
  scene.add(angleDim);

  // ─── 焊缝标注（橙色） ─────────────────────────────
  const weld1 = new WeldAnnotation3D(materials, {
    position: new THREE.Vector3(1000, 0, 0),
    label: 'W1-Butt',
    isShop: false,
    crossSize: 80,
  });
  weld1.setMaterialSet(materials.orange);
  scene.add(weld1);

  const weld2 = new WeldAnnotation3D(materials, {
    position: new THREE.Vector3(1000, 800, 0),
    label: 'W2-Butt',
    isShop: false,
    crossSize: 80,
  });
  weld2.setMaterialSet(materials.orange);
  scene.add(weld2);

  // ─── 坡度标注（蓝色/紫色） ──────────────────────────
  const slope1 = new SlopeAnnotation3D(materials, {
    start: new THREE.Vector3(0, 0, 0),
    end: new THREE.Vector3(1000, 0, 0),
    text: '1%↗',
    slope: 0.01,
  });
  slope1.setMaterialSet(materials.blue);
  scene.add(slope1);

  // ─── 渲染器 ─────────────────────────────────────────
  let renderer: THREE.WebGLRenderer | null = null;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.max(1, window.devicePixelRatio || 1));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    setStatus('WebGL 渲染器已创建');
  } catch (e) {
    setStatus('WebGL 不可用: ' + String(e));
    window.__mbdPipeSandboxReady = true;
    return;
  }

  // ─── OrbitControls ──────────────────────────────────
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(1000, 400, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.update();

  // ─── 收集所有标注对象用于 update() ──────────────────
  const allAnnotations = [
    dimSeg1, dimSeg2, dimSeg3,
    dimChain1, dimChain2, dimChain3,
    dimOverall, dimPort,
    angleDim,
    weld1, weld2,
    slope1,
  ];

  // Set text background occlusion color to match scene background
  for (const a of allAnnotations) a.setBackgroundColor(0x0b1020);

  // ─── 渲染循环 ───────────────────────────────────────
  function resize(): void {
    const w = canvas!.clientWidth || window.innerWidth;
    const h = canvas!.clientHeight || (window.innerHeight - 40);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    renderer?.setSize(w, h, false);
    materials.setResolution(w, h);
  }
  resize();
  window.addEventListener('resize', resize);

  let frame = 0;
  function tick(): void {
    controls.update();
    // 标注 update（billboard / scale-independent）
    for (const a of allAnnotations) {
      a.update(camera);
    }
    renderer?.render(scene, camera);
    frame++;
    if (frame === 1) {
      setStatus(
        `已渲染 ${allAnnotations.length} 个标注` +
        '（segment×3 chain×3 overall×1 port×1 angle×1 weld×2 slope×1）' +
        '— 鼠标拖拽旋转 / 滚轮缩放'
      );
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  window.__mbdPipeSandboxReady = true;
}

main();
