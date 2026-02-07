/**
 * 在 DTX Viewer 中注入模拟 BRAN 管道几何体 + MBD 标注
 *
 * 用于 ?dtx_demo=mbd_pipe 模式，不依赖任何后端服务。
 * 管道使用 Three.js 基本体直接加入 scene，标注通过 useMbdPipeAnnotationThree.renderBranch() 渲染。
 */

import * as THREE from 'three'
import type { DtxViewer } from '@/viewer/dtx/DtxViewer'
import type { MbdPipeData } from '@/api/mbdPipeApi'

/** 模拟管道 L 形布局（单位 mm，与标注坐标一致） */
export function injectMbdPipeDemoGeometry(dtxViewer: DtxViewer): THREE.Group {
  const group = new THREE.Group()
  group.name = 'mbd-pipe-demo-geometry'

  const pipeRadius = 50
  const pipeMat = new THREE.MeshStandardMaterial({
    color: 0x0ea5e9,
    roughness: 0.4,
    metalness: 0.3,
    transparent: true,
    opacity: 0.75,
  })
  const elbowMat = new THREE.MeshStandardMaterial({
    color: 0x06b6d4,
    roughness: 0.5,
    metalness: 0.3,
  })
  const endpointGeom = new THREE.SphereGeometry(25, 12, 12)

  // 段1: (0,0,0) → (1000,0,0) 水平
  const seg1G = new THREE.CylinderGeometry(pipeRadius, pipeRadius, 1000, 24)
  seg1G.rotateZ(Math.PI / 2)
  const seg1 = new THREE.Mesh(seg1G, pipeMat)
  seg1.position.set(500, 0, 0)
  group.add(seg1)

  // 段2: (1000,0,0) → (1000,800,0) 竖直
  const seg2G = new THREE.CylinderGeometry(pipeRadius, pipeRadius, 800, 24)
  const seg2 = new THREE.Mesh(seg2G, pipeMat)
  seg2.position.set(1000, 400, 0)
  group.add(seg2)

  // 段3: (1000,800,0) → (2200,800,0) 水平
  const seg3G = new THREE.CylinderGeometry(pipeRadius, pipeRadius, 1200, 24)
  seg3G.rotateZ(Math.PI / 2)
  const seg3 = new THREE.Mesh(seg3G, pipeMat)
  seg3.position.set(1600, 800, 0)
  group.add(seg3)

  // 弯头
  const elbowG = new THREE.SphereGeometry(pipeRadius * 1.2, 16, 16)
  const e1 = new THREE.Mesh(elbowG, elbowMat)
  e1.position.set(1000, 0, 0)
  group.add(e1)
  const e2 = new THREE.Mesh(elbowG, elbowMat)
  e2.position.set(1000, 800, 0)
  group.add(e2)

  // 起点（绿）终点（红）
  const startM = new THREE.Mesh(endpointGeom, new THREE.MeshBasicMaterial({ color: 0x22c55e }))
  startM.position.set(0, 0, 0)
  group.add(startM)
  const endM = new THREE.Mesh(endpointGeom, new THREE.MeshBasicMaterial({ color: 0xef4444 }))
  endM.position.set(2200, 800, 0)
  group.add(endM)

  // 环境光 + 方向光（demo 自带，不影响已有灯光）
  group.add(new THREE.AmbientLight(0xffffff, 0.4))
  const dl = new THREE.DirectionalLight(0xffffff, 0.6)
  dl.position.set(3000, 5000, 4000)
  group.add(dl)

  dtxViewer.scene.add(group)
  return group
}

/** 适配 renderBranch 的模拟 MBD 数据 */
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
  stats: { segments_count: 3, dims_count: 8, welds_count: 2, slopes_count: 1 },
  debug_info: { source: 'mock', notes: ['dtx_demo=mbd_pipe 模式'] },
}

/** 将相机飞到管道位置 */
export function flyToPipeDemo(dtxViewer: DtxViewer): void {
  const center = new THREE.Vector3(1100, 400, 0)
  const distance = 3500
  const position = new THREE.Vector3(
    center.x + distance * 0.7,
    center.y + distance * 0.5,
    center.z + distance * 0.7,
  )
  dtxViewer.flyTo(position, center, { duration: 0.5 })
}
