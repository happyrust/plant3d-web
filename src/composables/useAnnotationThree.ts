/**
 * 三维标注系统 Composable
 *
 * 管理三维标注的创建、更新、渲染和销毁
 * 集成 CSS2DRenderer 用于文字标签渲染
 * 集成交互控制器用于点击、悬停、拖拽
 */

import { ref, shallowRef, watch, onUnmounted, type Ref, type ShallowRef } from 'vue'
import * as THREE from 'three'
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import {
  AnnotationMaterials,
  AnnotationBase,
  LinearDimension,
  LeaderAnnotation,
  AnnotationInteractionController,
  type LinearDimensionParams,
  type LeaderAnnotationParams,
  type AnnotationInteractionOptions,
  type AnnotationInteractionCallback,
} from '@/utils/three/annotation'
import type { DtxViewer } from '@/viewer/dtx/DtxViewer'

export interface UseAnnotationThreeOptions {
  /** 获取全局模型矩阵（用于坐标变换） */
  getGlobalModelMatrix?: (() => THREE.Matrix4 | null) | null
  /** 请求渲染回调 */
  requestRender?: (() => void) | null
  /** 交互选项 */
  interaction?: AnnotationInteractionOptions
}

export interface UseAnnotationThreeReturn {
  /** 所有标注的 Map */
  annotations: ShallowRef<Map<string, AnnotationBase>>
  /** 标注组（添加到场景中） */
  annotationGroup: THREE.Group
  /** 材质管理器 */
  materials: AnnotationMaterials
  /** 交互控制器 */
  interactionController: AnnotationInteractionController

  /** 当前悬停的标注 ID */
  hoveredId: Ref<string | null>
  /** 当前选中的标注 ID */
  selectedId: Ref<string | null>

  /** 创建线性尺寸标注 */
  createLinearDimension: (id: string, params: LinearDimensionParams) => LinearDimension
  /** 创建引线标注 */
  createLeaderAnnotation: (id: string, params: LeaderAnnotationParams) => LeaderAnnotation

  /** 添加标注 */
  addAnnotation: (id: string, annotation: AnnotationBase) => void
  /** 移除标注 */
  removeAnnotation: (id: string) => void
  /** 获取标注 */
  getAnnotation: (id: string) => AnnotationBase | undefined
  /** 清空所有标注 */
  clearAll: () => void

  /** 高亮标注 */
  highlightAnnotation: (id: string | null) => void
  /** 选中标注 */
  selectAnnotation: (id: string | null) => void

  /** 添加交互事件监听器 */
  onInteraction: (callback: AnnotationInteractionCallback) => () => void

  /** 每帧更新（在渲染循环中调用） */
  update: (camera: THREE.Camera) => void
  /** 渲染 CSS2D 标签（在主渲染之后调用） */
  renderLabels: (scene: THREE.Scene, camera: THREE.Camera) => void
  /** 更新分辨率（在 resize 时调用） */
  setResolution: (width: number, height: number) => void

  /** 初始化 CSS2DRenderer */
  initCSS2DRenderer: (container: HTMLElement, canvas: HTMLCanvasElement) => CSS2DRenderer
  /** 启用交互 */
  enableInteraction: (domElement: HTMLElement) => void
  /** 禁用交互 */
  disableInteraction: () => void
  /** 销毁 */
  dispose: () => void
}

export function useAnnotationThree(
  dtxViewerRef: Ref<DtxViewer | null>,
  containerRef: Ref<HTMLElement | null>,
  options: UseAnnotationThreeOptions = {}
): UseAnnotationThreeReturn {
  const { getGlobalModelMatrix, requestRender, interaction } = options

  // 标注集合
  const annotations = shallowRef<Map<string, AnnotationBase>>(new Map())

  // 材质管理器
  const materials = new AnnotationMaterials()

  // 标注组
  const annotationGroup = new THREE.Group()
  annotationGroup.name = 'annotations-3d'
  annotationGroup.renderOrder = 900
  annotationGroup.matrixAutoUpdate = false

  // CSS2D 渲染器
  let css2dRenderer: CSS2DRenderer | null = null

  // 交互控制器
  const interactionController = new AnnotationInteractionController(annotations.value, {
    enableHover: true,
    enableClick: true,
    enableDrag: false,
    ...interaction,
  })

  // 当前高亮的标注 ID
  const highlightedId = ref<string | null>(null)

  // 单位矩阵
  const identityMatrix = new THREE.Matrix4()

  // 交互事件触发渲染
  interactionController.on(() => {
    requestRender?.()
  })

  /** 初始化 CSS2DRenderer */
  function initCSS2DRenderer(container: HTMLElement, canvas: HTMLCanvasElement): CSS2DRenderer {
    if (css2dRenderer) {
      css2dRenderer.domElement.remove()
    }

    css2dRenderer = new CSS2DRenderer()
    css2dRenderer.setSize(canvas.clientWidth, canvas.clientHeight)
    css2dRenderer.domElement.style.position = 'absolute'
    css2dRenderer.domElement.style.top = '0'
    css2dRenderer.domElement.style.left = '0'
    css2dRenderer.domElement.style.pointerEvents = 'none'
    css2dRenderer.domElement.className = 'annotation-labels-container'
    container.appendChild(css2dRenderer.domElement)

    return css2dRenderer
  }

  /** 确保标注组已添加到场景 */
  function ensureGroupAttached(): void {
    const viewer = dtxViewerRef.value
    if (!viewer) return
    if (annotationGroup.parent !== viewer.scene) {
      try {
        annotationGroup.parent?.remove(annotationGroup)
      } catch { /* ignore */ }
      viewer.scene.add(annotationGroup)
    }
  }

  /** 更新标注组矩阵 */
  function updateGroupMatrix(): void {
    const gm = getGlobalModelMatrix?.() || identityMatrix
    annotationGroup.matrix.copy(gm)
    annotationGroup.updateMatrixWorld(true)
  }

  /** 添加标注 */
  function addAnnotation(id: string, annotation: AnnotationBase): void {
    if (annotations.value.has(id)) {
      removeAnnotation(id)
    }
    annotations.value.set(id, annotation)
    annotationGroup.add(annotation)
    // 触发响应式更新
    annotations.value = new Map(annotations.value)
    // 更新交互控制器的引用
    interactionController.setAnnotations(annotations.value)
    requestRender?.()
  }

  /** 移除标注 */
  function removeAnnotation(id: string): void {
    const annotation = annotations.value.get(id)
    if (annotation) {
      annotation.dispose()
      annotations.value.delete(id)
      annotations.value = new Map(annotations.value)
      interactionController.setAnnotations(annotations.value)
      requestRender?.()
    }
  }

  /** 获取标注 */
  function getAnnotation(id: string): AnnotationBase | undefined {
    return annotations.value.get(id)
  }

  /** 清空所有标注 */
  function clearAll(): void {
    for (const annotation of annotations.value.values()) {
      annotation.dispose()
    }
    annotations.value.clear()
    annotations.value = new Map()
    interactionController.setAnnotations(annotations.value)
    interactionController.clearSelection()
    requestRender?.()
  }

  /** 高亮标注 */
  function highlightAnnotation(id: string | null): void {
    // 取消之前的高亮
    if (highlightedId.value && highlightedId.value !== id) {
      const prev = annotations.value.get(highlightedId.value)
      if (prev) prev.highlighted = false
    }

    // 设置新的高亮
    highlightedId.value = id
    if (id) {
      const annotation = annotations.value.get(id)
      if (annotation) annotation.highlighted = true
    }

    requestRender?.()
  }

  /** 选中标注 */
  function selectAnnotation(id: string | null): void {
    interactionController.select(id)
    requestRender?.()
  }

  /** 添加交互事件监听器 */
  function onInteraction(callback: AnnotationInteractionCallback): () => void {
    return interactionController.on(callback)
  }

  /** 每帧更新 */
  function update(camera: THREE.Camera): void {
    updateGroupMatrix()
    interactionController.setCamera(camera)
    for (const annotation of annotations.value.values()) {
      annotation.update(camera)
    }
  }

  /** 渲染 CSS2D 标签 */
  function renderLabels(scene: THREE.Scene, camera: THREE.Camera): void {
    css2dRenderer?.render(scene, camera)
  }

  /** 更新分辨率 */
  function setResolution(width: number, height: number): void {
    materials.setResolution(width, height)
    css2dRenderer?.setSize(width, height)
  }

  /** 创建线性尺寸标注 */
  function createLinearDimension(id: string, params: LinearDimensionParams): LinearDimension {
    ensureGroupAttached()
    const dim = new LinearDimension(materials, params)
    addAnnotation(id, dim)
    return dim
  }

  /** 创建引线标注 */
  function createLeaderAnnotation(id: string, params: LeaderAnnotationParams): LeaderAnnotation {
    ensureGroupAttached()
    const leader = new LeaderAnnotation(materials, params)
    addAnnotation(id, leader)
    return leader
  }

  /** 启用交互 */
  function enableInteraction(domElement: HTMLElement): void {
    interactionController.attach(domElement)
  }

  /** 禁用交互 */
  function disableInteraction(): void {
    interactionController.detach()
  }

  /** 销毁 */
  function dispose(): void {
    interactionController.dispose()
    clearAll()
    materials.dispose()
    css2dRenderer?.domElement.remove()
    css2dRenderer = null
    annotationGroup.removeFromParent()
  }

  // 监听 viewer 变化
  watch(dtxViewerRef, (viewer, prev) => {
    if (prev && annotationGroup.parent === prev.scene) {
      prev.scene.remove(annotationGroup)
    }
    if (viewer) {
      ensureGroupAttached()
      const container = containerRef.value
      if (container && !css2dRenderer) {
        initCSS2DRenderer(container, viewer.canvas)
      }
    }
  }, { immediate: true })

  // 组件卸载时清理
  onUnmounted(() => {
    dispose()
  })

  return {
    annotations,
    annotationGroup,
    materials,
    interactionController,
    hoveredId: interactionController.hoveredId,
    selectedId: interactionController.selectedId,
    createLinearDimension,
    createLeaderAnnotation,
    addAnnotation,
    removeAnnotation,
    getAnnotation,
    clearAll,
    highlightAnnotation,
    selectAnnotation,
    onInteraction,
    update,
    renderLabels,
    setResolution,
    initCSS2DRenderer,
    enableInteraction,
    disableInteraction,
    dispose,
  }
}
