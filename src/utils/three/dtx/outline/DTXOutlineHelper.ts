/**
 * DTXOutlineHelper - Outline 轮廓高亮辅助器
 *
 * 为选中的 DTX 对象添加轮廓高亮效果。
 * 使用 Three.js OutlinePass 实现，通过替身 Mesh 技术避免修改原始材质。
 */

import {
  Box3,
  BufferGeometry,
  Camera,
  Color,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Scene,
  Vector2,
  WebGLRenderer
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';

// ========== 类型定义 ==========

/**
 * Outline 样式配置
 */
export type OutlineStyle = {
  /** 边缘颜色 (默认橙色 #ff8800) */
  edgeColor?: Color | number | string;
  /** 边缘强度 (默认 2.5) */
  edgeStrength?: number;
  /** 发光强度 (默认 0.5) */
  edgeGlow?: number;
  /** 边缘厚度 (默认 1.0) */
  edgeThickness?: number;
  /** 脉冲周期 (0 = 不闪烁) */
  pulsePeriod?: number;
}

/**
 * 对象几何体获取器
 */
export type GeometryGetter = (objectId: string) => {
  geometry: BufferGeometry;
  matrix: Matrix4;
} | null;

// ========== 常量 ==========

const DEFAULT_EDGE_COLOR = 0xff8800;
const DEFAULT_EDGE_STRENGTH = 2.5;
const DEFAULT_EDGE_GLOW = 0.5;
const DEFAULT_EDGE_THICKNESS = 1.0;

// ========== DTXOutlineHelper 类 ==========

/**
 * DTX Outline 辅助器
 */
export class DTXOutlineHelper {
  private _scene: Scene;
  private _camera: Camera;
  private _renderer: WebGLRenderer;

  // 后处理
  private _composer: EffectComposer | null = null;
  private _outlinePass: OutlinePass | null = null;
  private _fxaaPass: ShaderPass | null = null;
  private _outputPass: OutputPass | null = null;

  // 替身组
  private _outlineGroup: Group;
  private _outlinedObjects: Map<string, Mesh> = new Map<string, Mesh>();

  // 几何体获取器
  private _geometryGetter: GeometryGetter | null = null;

  // 样式
  private _style: Required<OutlineStyle>;

  // 是否启用
  private _enabled = true;

  constructor(scene: Scene, camera: Camera, renderer: WebGLRenderer) {
    this._scene = scene;
    this._camera = camera;
    this._renderer = renderer;

    // 创建替身组
    this._outlineGroup = new Group();
    this._outlineGroup.name = 'DTXOutlineHelpers';

    // 默认样式
    this._style = {
      edgeColor: new Color(DEFAULT_EDGE_COLOR),
      edgeStrength: DEFAULT_EDGE_STRENGTH,
      edgeGlow: DEFAULT_EDGE_GLOW,
      edgeThickness: DEFAULT_EDGE_THICKNESS,
      pulsePeriod: 0
    };
  }

  /**
   * 初始化后处理管线
   */
  init(): void {
    if (this._composer) return;

    const size = this._renderer.getSize(new Vector2());
    const pixelRatio = this._renderer.getPixelRatio ? this._renderer.getPixelRatio() : 1;

    // 创建 EffectComposer
    this._composer = new EffectComposer(this._renderer);
    this._composer.setPixelRatio(pixelRatio);
    this._composer.setSize(size.x, size.y);

    // 渲染通道
    const renderPass = new RenderPass(this._scene, this._camera);
    this._composer.addPass(renderPass);

    // Outline 通道
    this._outlinePass = new OutlinePass(
      new Vector2(size.x, size.y),
      this._scene,
      this._camera
    );
    this._applyStyle();
    this._composer.addPass(this._outlinePass);

    // FXAA 抗锯齿
    this._fxaaPass = new ShaderPass(FXAAShader);
    this._fxaaPass.uniforms['resolution']!.value.set(1 / (size.x * pixelRatio), 1 / (size.y * pixelRatio));
    this._composer.addPass(this._fxaaPass);

    this._outputPass = new OutputPass();
    this._composer.addPass(this._outputPass);

    // 添加替身组到场景
    this._scene.add(this._outlineGroup);
  }

  /**
   * 设置几何体获取器
   */
  setGeometryGetter(getter: GeometryGetter): void {
    this._geometryGetter = getter;
  }

  /**
   * 设置需要显示轮廓的对象
   */
  setOutlinedObjects(objectIds: string[]): void {
    // 清除旧的替身
    this.clearOutline();

    if (!this._geometryGetter || objectIds.length === 0) {
      return;
    }

    // 为每个对象创建替身
    for (const objectId of objectIds) {
      const data = this._geometryGetter(objectId);
      if (!data) continue;

      // 创建透明替身 Mesh
      const material = new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.0,
        depthWrite: false
      });

      const mesh = new Mesh(data.geometry, material);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(data.matrix);
      mesh.name = `outline_${objectId}`;

      this._outlineGroup.add(mesh);
      this._outlinedObjects.set(objectId, mesh);
    }

    // 更新 OutlinePass
    if (this._outlinePass) {
      this._outlinePass.selectedObjects = this._outlineGroup.children;
    }
  }

  /**
   * 添加单个对象的轮廓
   */
  addOutlinedObject(objectId: string): void {
    if (this._outlinedObjects.has(objectId)) return;
    if (!this._geometryGetter) return;

    const data = this._geometryGetter(objectId);
    if (!data) return;

    const material = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.0,
      depthWrite: false
    });

    const mesh = new Mesh(data.geometry, material);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(data.matrix);
    mesh.name = `outline_${objectId}`;

    this._outlineGroup.add(mesh);
    this._outlinedObjects.set(objectId, mesh);

    if (this._outlinePass) {
      this._outlinePass.selectedObjects = this._outlineGroup.children;
    }
  }

  /**
   * 移除单个对象的轮廓
   */
  removeOutlinedObject(objectId: string): void {
    const mesh = this._outlinedObjects.get(objectId);
    if (!mesh) return;

    this._outlineGroup.remove(mesh);
    (mesh.material as MeshBasicMaterial).dispose();
    this._outlinedObjects.delete(objectId);

    if (this._outlinePass) {
      this._outlinePass.selectedObjects = this._outlineGroup.children;
    }
  }

  /**
   * 清除所有轮廓
   */
  clearOutline(): void {
    for (const [, mesh] of this._outlinedObjects) {
      this._outlineGroup.remove(mesh);
      (mesh.material as MeshBasicMaterial).dispose();
    }
    this._outlinedObjects.clear();

    if (this._outlinePass) {
      this._outlinePass.selectedObjects = [];
    }
  }

  /**
   * 获取当前显示轮廓的对象 ID 列表
   */
  getOutlinedObjects(): string[] {
    return Array.from(this._outlinedObjects.keys());
  }

  /**
   * 设置轮廓样式
   */
  setStyle(style: OutlineStyle): void {
    if (style.edgeColor !== undefined) {
      this._style.edgeColor = style.edgeColor instanceof Color
        ? style.edgeColor
        : new Color(style.edgeColor);
    }
    if (style.edgeStrength !== undefined) {
      this._style.edgeStrength = style.edgeStrength;
    }
    if (style.edgeGlow !== undefined) {
      this._style.edgeGlow = style.edgeGlow;
    }
    if (style.edgeThickness !== undefined) {
      this._style.edgeThickness = style.edgeThickness;
    }
    if (style.pulsePeriod !== undefined) {
      this._style.pulsePeriod = style.pulsePeriod;
    }

    this._applyStyle();
  }

  /**
   * 应用样式到 OutlinePass
   */
  private _applyStyle(): void {
    if (!this._outlinePass) return;

    this._outlinePass.visibleEdgeColor.copy(this._style.edgeColor as Color);
    this._outlinePass.hiddenEdgeColor.copy(this._style.edgeColor as Color);
    this._outlinePass.edgeStrength = this._style.edgeStrength;
    this._outlinePass.edgeGlow = this._style.edgeGlow;
    this._outlinePass.edgeThickness = this._style.edgeThickness;
    this._outlinePass.pulsePeriod = this._style.pulsePeriod;
  }

  /**
   * 设置是否启用
   */
  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
    if (this._outlinePass) {
      this._outlinePass.enabled = enabled;
    }
  }

  /**
   * 获取是否启用
   */
  get enabled(): boolean {
    return this._enabled;
  }

  /**
   * 调整大小
   */
  resize(width: number, height: number): void {
    const pixelRatio = this._renderer.getPixelRatio ? this._renderer.getPixelRatio() : 1;
    if (this._composer) {
      this._composer.setPixelRatio(pixelRatio);
      this._composer.setSize(width, height);
    }
    if (this._fxaaPass) {
      this._fxaaPass.uniforms['resolution']!.value.set(1 / (width * pixelRatio), 1 / (height * pixelRatio));
    }
  }

  /**
   * 渲染
   */
  render(): void {
    if (!this._composer) return;

    if (this._outlinePass) {
      this._outlinePass.enabled = this._enabled && this._outlinedObjects.size > 0;
    }

    this._composer.render();
  }

  /**
   * 获取 EffectComposer (用于外部集成)
   */
  getComposer(): EffectComposer | null {
    return this._composer;
  }

  /**
   * 获取 OutlinePass (用于外部配置)
   */
  getOutlinePass(): OutlinePass | null {
    return this._outlinePass;
  }

  /**
   * 释放资源
   */
  dispose(): void {
    this.clearOutline();

    if (this._outlineGroup.parent) {
      this._outlineGroup.parent.remove(this._outlineGroup);
    }

    if (this._composer) {
      this._composer.dispose();
      this._composer = null;
    }

    this._outlinePass = null;
    this._fxaaPass = null;
    this._outputPass = null;
    this._geometryGetter = null;
  }
}
