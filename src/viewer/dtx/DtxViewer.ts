import {
  ACESFilmicToneMapping,
  AmbientLight,
  CanvasTexture,
  Color,
  CubeTexture,
  DirectionalLight,
  Object3D,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ViewportGizmo } from 'three-viewport-gizmo';

export type FlyToOptions = {
  duration?: number; // ms
};

export type DtxViewerOptions = {
  canvas: HTMLCanvasElement;
  background?: number | string;
  debug?: boolean;
  gizmo?: boolean | ViewportGizmoOptions;
  /** 天空盒十字形展开图 URL（可选，设置后自动加载） */
  skybox?: string;
};

export type ViewportGizmoOptions = {
  enabled?: boolean;
  placement?:
  | 'top-left'
  | 'top-right'
  | 'top-center'
  | 'center-right'
  | 'center-left'
  | 'center-center'
  | 'bottom-left'
  | 'bottom-right'
  | 'bottom-center';
  size?: number;
  offset?: { left?: number; top?: number; right?: number; bottom?: number };
};

export class DtxViewer {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly gizmo: ViewportGizmo | null;

  private _rafId: number | null = null;
  private _debug: boolean;
  private _gizmoEnabled: boolean;

  constructor(options: DtxViewerOptions) {
    this.canvas = options.canvas;
    this._debug = options.debug === true;

    // 全局使用 Z-up（与 E3D/DTX 坐标系一致；ViewportGizmo 也会参考 DEFAULT_UP 做坐标转换）
    try {
      Object3D.DEFAULT_UP.set(0, 0, 1);
    } catch {
      // ignore
    }

    const gl = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: true,
      depth: true,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) {
      throw new Error('需要 WebGL2（canvas.getContext("webgl2") 失败）');
    }

    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      context: gl,
      antialias: true,
      alpha: false,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    this.renderer.setPixelRatio(Math.max(1, window.devicePixelRatio || 1));

    this.scene = new Scene();
    this.scene.background = new Color(options.background ?? 0xe5e7eb);

    // CAD 弱透视：降低 FOV，减少近大远小夸张感
    this.camera = new PerspectiveCamera(30, 1, 0.1, 1_000_000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(-37.1, 13.0, 58.5);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(-21.93, 1.35, 29.45);
    this.controls.update();

    // 解析 gizmo 配置
    const gizmoConfig = this._parseGizmoOptions(options.gizmo);
    this._gizmoEnabled = gizmoConfig.enabled;

    // 初始化 ViewportGizmo
    if (this._gizmoEnabled) {
      this.gizmo = new ViewportGizmo(this.camera, this.renderer, {
        container: this.canvas.parentElement ?? this.canvas,
        placement: gizmoConfig.placement,
        size: gizmoConfig.size,
        offset: gizmoConfig.offset,
      });
      this.gizmo.target = this.controls.target;
      // 与 OrbitControls 协作（库内部会处理交互状态/同步更新）
      this.gizmo.attachControls(this.controls);
    } else {
      this.gizmo = null;
    }

    this._setupDefaultLights();

    // 如果配置了天空盒，自动加载
    if (options.skybox) {
      this.loadCrossSkybox(options.skybox);
    }
  }

  private _parseGizmoOptions(
    gizmoOption?: boolean | ViewportGizmoOptions,
  ): Omit<ViewportGizmoOptions, 'enabled'> & { enabled: boolean } {
    if (gizmoOption === false) {
      return { enabled: false, placement: 'top-right', size: 100, offset: {} };
    }
    if (gizmoOption === true || gizmoOption === undefined) {
      return { enabled: true, placement: 'top-right', size: 100, offset: {} };
    }
    return {
      enabled: gizmoOption.enabled !== false,
      placement: gizmoOption.placement ?? 'top-right',
      size: gizmoOption.size ?? 100,
      offset: gizmoOption.offset ?? {},
    };
  }

  private _setupDefaultLights(): void {
    const ambient = new AmbientLight(0xffffff, 0.4);
    ambient.name = 'DtxAmbientLight';
    this.scene.add(ambient);

    const dir0 = new DirectionalLight(0xffffff, 1.2);
    dir0.position.set(0.9, 1.3, 1.1);
    dir0.name = 'DtxDirectionalLight0';
    this.scene.add(dir0);

    const dir1 = new DirectionalLight(0xffffff, 0.55);
    dir1.position.set(-0.8, 0.2, -0.9);
    dir1.name = 'DtxDirectionalLight1';
    this.scene.add(dir1);
  }

  setSize(cssWidth: number, cssHeight: number): void {
    const w = Math.max(1, Math.floor(cssWidth));
    const h = Math.max(1, Math.floor(cssHeight));
    const dpr = Math.max(1, window.devicePixelRatio || 1);

    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    try {
      this.gizmo?.update();
    } catch {
      // ignore
    }
  }

  start(): void {
    if (this._rafId !== null) return;

    const tick = () => {
      this._rafId = window.requestAnimationFrame(tick);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      // 渲染 gizmo（如果启用）
      if (this.gizmo) {
        this.gizmo.render();
      }
    };

    this._rafId = window.requestAnimationFrame(tick);
  }

  stop(): void {
    if (this._rafId === null) return;
    window.cancelAnimationFrame(this._rafId);
    this._rafId = null;
  }

  dispose(): void {
    this.stop();
    try {
      this.controls.dispose();
    } catch {
      // ignore
    }
    try {
      this.gizmo?.dispose();
    } catch {
      // ignore
    }
    try {
      this.renderer.dispose();
    } catch {
      // ignore
    }
  }

  flyTo(position: Vector3, target: Vector3, options: FlyToOptions = {}): void {
    const duration = Math.max(0, options.duration ?? 800);
    if (duration === 0) {
      this.camera.position.copy(position);
      this.controls.target.copy(target);
      this.controls.update();
      return;
    }

    const fromPos = this.camera.position.clone();
    const fromTarget = this.controls.target.clone();
    const toPos = position.clone();
    const toTarget = target.clone();

    const start = performance.now();
    const easeInOut = (t: number) =>
      t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

    const step = () => {
      const now = performance.now();
      const t = Math.min(1, (now - start) / duration);
      const k = easeInOut(t);
      this.camera.position.lerpVectors(fromPos, toPos, k);
      this.controls.target.lerpVectors(fromTarget, toTarget, k);
      this.controls.update();
      if (t < 1) {
        window.requestAnimationFrame(step);
      } else if (this._debug) {
         
        console.log('[DtxViewer] flyTo done', { duration });
      }
    };

    window.requestAnimationFrame(step);
  }

  /**
   * 设置垂直渐变背景（顶→底）
   * 使用 offscreen canvas 绘制线性渐变，生成 CanvasTexture 作为场景背景。
   */
  setGradientBackground(topColor: string, bottomColor: string): void {
    const w = 2;
    const h = 512;
    const cvs = document.createElement('canvas');
    cvs.width = w;
    cvs.height = h;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, topColor);
    grad.addColorStop(1, bottomColor);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    const tex = new CanvasTexture(cvs);
    tex.needsUpdate = true;
    this.scene.background = tex;
    // 渐变模式下不使用环境映射
    this.scene.environment = null;
  }

  /**
   * 设置纯色背景
   */
  setSolidBackground(color: number | string): void {
    this.scene.background = new Color(color);
    this.scene.environment = null;
  }

  /**
   * 清除 skybox 背景和环境映射
   */
  clearSkybox(): void {
    this.scene.environment = null;
  }

  loadCrossSkybox(url: string): void {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      // 十字形展开图: 4列 x 3行
      const faceWidth = img.width / 4;
      const faceHeight = img.height / 3;

      // 定义6个面的位置 (列, 行)
      // Three.js CubeTexture 顺序: px, nx, py, ny, pz, nz
      const facePositions: Record<string, { col: number; row: number }> = {
        px: { col: 2, row: 1 }, // 右
        nx: { col: 0, row: 1 }, // 左
        py: { col: 1, row: 0 }, // 上
        ny: { col: 1, row: 2 }, // 下
        pz: { col: 1, row: 1 }, // 前
        nz: { col: 3, row: 1 }, // 后
      };

      const faceOrder = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
      const faceCanvases: HTMLCanvasElement[] = [];

      faceOrder.forEach((face) => {
        const canvas = document.createElement('canvas');
        canvas.width = faceWidth;
        canvas.height = faceHeight;
        const ctx = canvas.getContext('2d');

        if (ctx) {
          const pos = facePositions[face];
          if (!pos) return;
          ctx.drawImage(
            img,
            pos.col * faceWidth, // 源图 x
            pos.row * faceHeight, // 源图 y
            faceWidth, // 源图宽度
            faceHeight, // 源图高度
            0,
            0, // 目标位置
            faceWidth, // 目标宽度
            faceHeight // 目标高度
          );
        }

        faceCanvases.push(canvas);
      });

      // 创建 CubeTexture
      const cubeTexture = new CubeTexture(faceCanvases);
      cubeTexture.needsUpdate = true;

      // 设置为场景背景和环境映射（环境映射直接影响 PBR 材质的感官效果）
      this.scene.background = cubeTexture;
      this.scene.environment = cubeTexture;

      // 强制更新所有材质的环境关联
      this.scene.traverse((obj) => {
        if ((obj as any).isMesh && (obj as any).material) {
          (obj as any).material.needsUpdate = true;
        }
      });

      if (this._debug) {
         
        console.log('🌌 Skybox 加载完成，已应用到背景与环境映射');
      }
    };

    img.onerror = (err) => {
       
      console.warn('🌌 Skybox 纹理加载失败:', err);
    };

    img.src = url;
  }
}

export type BackgroundMode =
  | 'gradient_engineering_gray'
  | 'gradient_solidworks'
  | 'gradient_dark'
  | 'solid_light'
  | 'solid_dark'
  | 'skybox'

export type BackgroundPreset = {
  mode: BackgroundMode
  label: string
  topColor: string
  bottomColor: string
}

export const BACKGROUND_PRESETS: BackgroundPreset[] = [
  { mode: 'gradient_engineering_gray', label: '工程灰', topColor: '#d0d4d8', bottomColor: '#9ca3ab' },
  { mode: 'gradient_solidworks', label: 'SolidWorks', topColor: '#edf1f7', bottomColor: '#cfd7e6' },
  { mode: 'gradient_dark', label: '深色渐变', topColor: '#3a4a5c', bottomColor: '#1a202c' },
  { mode: 'solid_light', label: '浅灰纯色', topColor: '#e5e7eb', bottomColor: '#e5e7eb' },
  { mode: 'solid_dark', label: '深色纯色', topColor: '#1e293b', bottomColor: '#1e293b' },
  { mode: 'skybox', label: '天空盒', topColor: '#87ceeb', bottomColor: '#4682b4' },
];
