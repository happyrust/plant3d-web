import {
  ACESFilmicToneMapping,
  AmbientLight,
  Color,
  DirectionalLight,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type FlyToOptions = {
  duration?: number; // ms
};

export type DtxViewerOptions = {
  canvas: HTMLCanvasElement;
  background?: number | string;
  debug?: boolean;
};

export class DtxViewer {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;

  private _rafId: number | null = null;
  private _debug: boolean;

  constructor(options: DtxViewerOptions) {
    this.canvas = options.canvas;
    this._debug = options.debug === true;

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

    this._setupDefaultLights();
  }

  private _setupDefaultLights(): void {
    const ambient = new AmbientLight(0xffffff, 0.35);
    ambient.name = 'DtxAmbientLight';
    this.scene.add(ambient);

    const dir0 = new DirectionalLight(0xffffff, 0.9);
    dir0.position.set(1, 1, 1);
    dir0.name = 'DtxDirectionalLight0';
    this.scene.add(dir0);

    const dir1 = new DirectionalLight(0xffffff, 0.25);
    dir1.position.set(-1, 0.4, -1);
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
  }

  start(): void {
    if (this._rafId !== null) return;

    const tick = () => {
      this._rafId = window.requestAnimationFrame(tick);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
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
    const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

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
        console.log('[DtxViewer] flyTo done', { duration });
      }
    };

    window.requestAnimationFrame(step);
  }
}

