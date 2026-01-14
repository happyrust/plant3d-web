import {
  ACESFilmicToneMapping,
  AmbientLight,
  Color,
  DirectionalLight,
  Object3D,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { ViewportGizmo } from "three-viewport-gizmo";

export type FlyToOptions = {
  duration?: number; // ms
};

export type DtxViewerOptions = {
  canvas: HTMLCanvasElement;
  background?: number | string;
  debug?: boolean;
  gizmo?: boolean | ViewportGizmoOptions;
};

export type ViewportGizmoOptions = {
  enabled?: boolean;
  placement?:
    | "top-left"
    | "top-right"
    | "top-center"
    | "center-right"
    | "center-left"
    | "center-center"
    | "bottom-left"
    | "bottom-right"
    | "bottom-center";
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

    const gl = this.canvas.getContext("webgl2", {
      alpha: false,
      antialias: true,
      depth: true,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
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
    this.renderer.setPixelRatio(Math.max(1, window.devicePixelRatio || 1));

    this.scene = new Scene();
    this.scene.background = new Color(options.background ?? 0xe5e7eb);

    this.camera = new PerspectiveCamera(45, 1, 0.1, 1_000_000);
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
  }

  private _parseGizmoOptions(
    gizmoOption?: boolean | ViewportGizmoOptions,
  ): Omit<ViewportGizmoOptions, "enabled"> & { enabled: boolean } {
    if (gizmoOption === false) {
      return { enabled: false, placement: "top-right", size: 100, offset: {} };
    }
    if (gizmoOption === true || gizmoOption === undefined) {
      return { enabled: true, placement: "top-right", size: 100, offset: {} };
    }
    return {
      enabled: gizmoOption.enabled !== false,
      placement: gizmoOption.placement ?? "top-right",
      size: gizmoOption.size ?? 100,
      offset: gizmoOption.offset ?? {},
    };
  }

  private _setupDefaultLights(): void {
    const ambient = new AmbientLight(0xffffff, 0.35);
    ambient.name = "DtxAmbientLight";
    this.scene.add(ambient);

    const dir0 = new DirectionalLight(0xffffff, 0.9);
    dir0.position.set(1, 1, 1);
    dir0.name = "DtxDirectionalLight0";
    this.scene.add(dir0);

    const dir1 = new DirectionalLight(0xffffff, 0.25);
    dir1.position.set(-1, 0.4, -1);
    dir1.name = "DtxDirectionalLight1";
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
        // eslint-disable-next-line no-console
        console.log("[DtxViewer] flyTo done", { duration });
      }
    };

    window.requestAnimationFrame(step);
  }
}
