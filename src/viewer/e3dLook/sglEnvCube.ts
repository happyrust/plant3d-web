/**
 * sglDx11 内嵌的环境立方体贴图（`gEnvTexture`）。
 *
 * E3D 3.1 的 `sglDx11.dll` .data 里嵌着一张 DDS（128²×6 面、B8G8R8A8、无 mip、灰度「摄影棚」环境），
 * 前向着色的反射项 `Kr · env(reflect(−V, N))` 采的就是它（逆向见
 * `D:\ida_scratch\plant3\render\REPORT-2026-09-20-E3D渲染管线分析-第二轮.md` §4）。
 * 六面按 DDS 顺序 +X −X +Y −Y +Z −Z 导出成 PNG 放在 `public/texture/e3d/sgl31-envcube/`。
 *
 * 采样方向：sglDx11 的像素着色器把 Z-up 世界空间的反射向量换到 Y-up 再 `texCUBE`——
 * `sample r2.xyz, r3.xzwx` 且 `r3.w = -r3.y`，即 `cubeDir = (R.x, R.z, −R.y)`。
 * D3D 与 WebGL 的立方体贴图面选择/朝向约定同源（RenderMan），六面原样上传（flipY=false）
 * 后用同一向量 `textureCube` 即得同一结果。
 */

import { CubeTexture, CubeTextureLoader, LinearFilter, Matrix3, NoColorSpace, Vector3 } from 'three';

/** 六面文件名，顺序 = three `CubeTexture.images` / DDS 面顺序：+X −X +Y −Y +Z −Z */
export const SGL31_ENVCUBE_FACE_FILES: readonly string[] = Object.freeze([
  'px.png',
  'nx.png',
  'py.png',
  'ny.png',
  'pz.png',
  'nz.png',
]);

/** 相对站点根（`import.meta.env.BASE_URL`）的目录 */
export const SGL31_ENVCUBE_DIR = 'texture/e3d/sgl31-envcube/';

/** 六面 URL（`baseUrl` 缺省取 Vite 的 BASE_URL） */
export function sgl31EnvCubeUrls(baseUrl?: string): string[] {
  const base = normalizeBase(baseUrl ?? viteBaseUrl());
  return SGL31_ENVCUBE_FACE_FILES.map((f) => `${base}${SGL31_ENVCUBE_DIR}${f}`);
}

function viteBaseUrl(): string {
  const env = (import.meta as unknown as { env?: { BASE_URL?: string } }).env;
  return env?.BASE_URL ?? '/';
}

function normalizeBase(base: string): string {
  if (!base) return '/';
  return base.endsWith('/') ? base : `${base}/`;
}

/**
 * 世界空间 → 立方体贴图空间的旋转（列主序 `Matrix3`，着色器里 `cubeDir = uEnvRot * R`）。
 *
 * - Z-up 世界（E3D / 本项目 DTX 场景，`camera.up = (0,0,1)`）：`(x, y, z) → (x, z, −y)`，与 sglDx11 一致；
 * - Y-up 世界：单位阵（贴图本来就是 Y-up）。
 * 其它 up 向量按与 Z 轴的夹角就近归到这两类。
 */
export function envCubeRotationForUp(up: Vector3, target = new Matrix3()): Matrix3 {
  const zUp = Math.abs(up.z) >= Math.abs(up.y);
  if (zUp) {
    // 行：cube.x = x, cube.y = z, cube.z = −y（Matrix3.set 按行给）
    return target.set(
      1, 0, 0,
      0, 0, 1,
      0, -1, 0,
    );
  }
  return target.identity();
}

/** 把六张已解码的图（或 ImageBitmap）装成与 sglDx11 采样口径一致的 CubeTexture */
export function createSglEnvCubeTexture(images: (HTMLImageElement | ImageBitmap | HTMLCanvasElement)[]): CubeTexture {
  if (images.length !== 6) throw new Error(`createSglEnvCubeTexture: 需要 6 面，收到 ${images.length}`);
  const tex = new CubeTexture(images);
  configureSglEnvCubeTexture(tex);
  tex.needsUpdate = true;
  return tex;
}

/**
 * 与 sglDx11 的 `samLinear` + 无 mip 的 DDS 对齐：双线性、不生成 mip；
 * 数据是 UNORM 字节直接采样、不做 sRGB 解码，所以 `colorSpace = NoColorSpace`。
 */
export function configureSglEnvCubeTexture(tex: CubeTexture): CubeTexture {
  tex.colorSpace = NoColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.flipY = false;
  tex.name = 'sgl31-envcube';
  return tex;
}

export interface LoadSglEnvCubeOptions {
  /** 站点根，缺省 `import.meta.env.BASE_URL` */
  baseUrl?: string;
  /** 自备 loader（测试 / 自定义 LoadingManager） */
  loader?: CubeTextureLoader;
}

let _sgl31EnvCubePromise: Promise<CubeTexture> | null = null;

/** 加载 3.1 的六面环境贴图；同一页面内只加载一次（失败后下次调用会重试） */
export function loadSgl31EnvCube(options: LoadSglEnvCubeOptions = {}): Promise<CubeTexture> {
  if (_sgl31EnvCubePromise && !options.loader && !options.baseUrl) return _sgl31EnvCubePromise;
  const loader = options.loader ?? new CubeTextureLoader();
  const p = new Promise<CubeTexture>((resolve, reject) => {
    loader.load(
      sgl31EnvCubeUrls(options.baseUrl),
      (tex) => resolve(configureSglEnvCubeTexture(tex)),
      undefined,
      (err) => reject(err instanceof Error ? err : new Error(String(err))),
    );
  });
  if (!options.loader && !options.baseUrl) {
    _sgl31EnvCubePromise = p;
    p.catch(() => {
      _sgl31EnvCubePromise = null;
    });
  }
  return p;
}
