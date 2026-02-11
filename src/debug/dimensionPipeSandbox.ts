import * as THREE from 'three'
import { AnnotationMaterials, LinearDimension3D } from '@/utils/three/annotation'
import { computePipeToWallClearance, computePipeToColumnClearance } from '@/utils/three/geometry/clearance/pipeClearance'

declare global {
  interface Window {
    __dimensionPipeSandboxReady?: boolean
    __dimensionPipeSandbox?: {
      getTexts: () => Record<string, string>
      getDistances: () => Record<string, number>
    }
  }
}

function main(): void {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement | null
  if (!canvas) {
    window.__dimensionPipeSandboxReady = true
    window.__dimensionPipeSandbox = { getTexts: () => ({}), getDistances: () => ({}) }
    return
  }

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0b1020)

  const camera = new THREE.PerspectiveCamera(55, 1, 0.01, 1000)
  camera.position.set(6, 5, 8)
  camera.lookAt(0, 0, 0)

  // lights（用于基本体可视化；标注本身不依赖灯光）
  scene.add(new THREE.AmbientLight(0xffffff, 0.6))
  const dir = new THREE.DirectionalLight(0xffffff, 0.8)
  dir.position.set(5, 10, 7)
  scene.add(dir)

  const materials = new AnnotationMaterials()

  // --- 基本体：墙（x=0 平面） ---
  const wallGeom = new THREE.BoxGeometry(0.1, 4, 6)
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.9, metalness: 0.0 })
  const wall = new THREE.Mesh(wallGeom, wallMat)
  wall.position.set(-0.05, 0, 0) // 使右侧面近似为 x=0
  scene.add(wall)

  // --- 基本体：管道（圆柱，轴向沿 Y） ---
  const pipeRadius = 1
  const gapWall = 0.5
  const pipeGeom = new THREE.CylinderGeometry(pipeRadius, pipeRadius, 6, 32)
  const pipeMat = new THREE.MeshStandardMaterial({ color: 0x0ea5e9, roughness: 0.5, metalness: 0.2 })
  const pipe = new THREE.Mesh(pipeGeom, pipeMat)
  pipe.position.set(pipeRadius + gapWall, 0, 0)
  scene.add(pipe)

  // --- 基本体：柱子（圆柱，轴向沿 Y） ---
  const columnRadius = 2
  const gapColumn = 0.5
  const colGeom = new THREE.CylinderGeometry(columnRadius, columnRadius, 6, 40)
  const colMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.85, metalness: 0.05 })
  const column = new THREE.Mesh(colGeom, colMat)
  // 注意：pipe 本身已偏离墙面（x=pipeRadius+gapWall）；柱子位置需在 pipe 基础上再偏移，保证净距为 gapColumn
  column.position.set(pipe.position.x + pipeRadius + columnRadius + gapColumn, 0, 0)
  scene.add(column)

  // --- 计算净距并创建标注 ---
  const pipeWall = computePipeToWallClearance({
    pipeCenter: pipe.position.clone(),
    pipeRadius,
    wallPoint: new THREE.Vector3(0, 0, 0),
    wallNormal: new THREE.Vector3(1, 0, 0),
  })

  const pipeColumn = computePipeToColumnClearance({
    pipeCenter: pipe.position.clone(),
    pipeRadius,
    columnCenter: column.position.clone(),
    columnRadius,
    axis: new THREE.Vector3(0, 1, 0),
  })

  const dimPipeWall = pipeWall
    ? new LinearDimension3D(materials, {
        start: pipeWall.otherSurfacePoint,
        end: pipeWall.pipeSurfacePoint,
        offset: 0.6,
        decimals: 2,
      })
    : null

  const dimPipeColumn = pipeColumn
    ? new LinearDimension3D(materials, {
        start: pipeColumn.otherSurfacePoint,
        end: pipeColumn.pipeSurfacePoint,
        offset: 1.0,
        decimals: 2,
      })
    : null

  if (dimPipeWall) {
    dimPipeWall.setBackgroundColor(0x0b1020)
    scene.add(dimPipeWall)
  }
  if (dimPipeColumn) {
    dimPipeColumn.setBackgroundColor(0x0b1020)
    scene.add(dimPipeColumn)
  }

  // 暴露给 Playwright：不依赖渲染，只读“计算结果/显示文本”
  window.__dimensionPipeSandbox = {
    getTexts: () => ({
      pipe_wall: dimPipeWall?.getDisplayText?.() ?? '',
      pipe_column: dimPipeColumn?.getDisplayText?.() ?? '',
    }),
    getDistances: () => ({
      pipe_wall: Number(dimPipeWall?.getDistance?.() ?? NaN),
      pipe_column: Number(dimPipeColumn?.getDistance?.() ?? NaN),
    }),
  }
  window.__dimensionPipeSandboxReady = true

  // 尝试渲染（若 headless 环境 WebGL 不可用，也不影响测试）
  let renderer: THREE.WebGLRenderer | null = null
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
    renderer.setPixelRatio(Math.max(1, window.devicePixelRatio || 1))
  } catch {
    renderer = null
  }

  function resize(): void {
    const w = canvas.clientWidth || window.innerWidth
    const h = canvas.clientHeight || (window.innerHeight - 40)
    camera.aspect = w / Math.max(1, h)
    camera.updateProjectionMatrix()
    renderer?.setSize(w, h, false)
    materials.setResolution(w, h)
  }
  resize()
  window.addEventListener('resize', resize)

  const clock = new THREE.Clock()
  function tick(): void {
    const _dt = clock.getDelta()
    // billboarding + scale-independent
    dimPipeWall?.update(camera)
    dimPipeColumn?.update(camera)
    renderer?.render(scene, camera)
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

main()
