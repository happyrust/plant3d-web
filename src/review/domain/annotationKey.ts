/**
 * annotationKey v1 前端生成策略。
 *
 * 用途：跨快照/跨恢复稳定归并评论与批注。详见
 * `开发文档/三维校审/批注体系重构-补遗与术语规范-2026-04-18.md` §3。
 *
 * 长期目标：由后端以 UUID v7 生成并回写；此模块仅在兼容期使用。
 */

export type AnnotationKeyType = 'text' | 'cloud' | 'rect' | 'obb';

export type Vec3 = [number, number, number];

export type GeometrySignature =
  | { kind: 'text'; anchor: Vec3 }
  | { kind: 'cloud'; points: Vec3[] }
  | { kind: 'rect'; center: Vec3; size: Vec3 }
  | { kind: 'obb'; center: Vec3; size: Vec3 };

export type AnnotationKeyInput = {
  annotationType: AnnotationKeyType;
  taskId: string;
  geometry: GeometrySignature;
  content?: string;
}

export const ANNOTATION_KEY_VERSION = 'v1' as const;
export const ANNOTATION_KEY_LENGTH = 16;
const UNIT_SEPARATOR = '\u001F';
const GEOMETRY_DECIMAL_DIGITS = 4;

function canonicalizeContent(raw: string | undefined): string {
  return String(raw ?? '')
    .trim()
    .normalize('NFC')
    .toLowerCase();
}

function fx(value: number): string {
  if (!Number.isFinite(value)) return '0.0000';
  return value.toFixed(GEOMETRY_DECIMAL_DIGITS);
}

function vec3Sig(v: Vec3): string {
  return `${fx(v[0])},${fx(v[1])},${fx(v[2])}`;
}

function computeGeometrySignature(geometry: GeometrySignature): string {
  switch (geometry.kind) {
    case 'text':
      return `text:${vec3Sig(geometry.anchor)}`;
    case 'cloud': {
      const flat = geometry.points
        .map((p) => vec3Sig(p))
        .join(';');
      return `cloud:${geometry.points.length}:${flat}`;
    }
    case 'rect':
    case 'obb':
      return `${geometry.kind}:${vec3Sig(geometry.center)}:${vec3Sig(geometry.size)}`;
  }
}

async function sha1Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-1', bytes);
  const arr = new Uint8Array(digest);
  let hex = '';
  for (const byte of arr) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * 计算 v1 版 annotationKey。
 *
 * 结果长度 = {@link ANNOTATION_KEY_LENGTH} 个 hex 字符（64 bit），
 * 在 1k-10k 批注规模下冲突概率可忽略。
 */
export async function computeAnnotationKeyV1(
  input: AnnotationKeyInput,
): Promise<string> {
  const parts = [
    `type:${input.annotationType}`,
    `task:${input.taskId}`,
    `geo:${computeGeometrySignature(input.geometry)}`,
    `content:${canonicalizeContent(input.content)}`,
  ];
  const hex = await sha1Hex(parts.join(UNIT_SEPARATOR));
  return hex.slice(0, ANNOTATION_KEY_LENGTH);
}

/**
 * 解析后端 v2 返回的 key；当不存在时返回 null，调用方 fallback 到 v1。
 */
export function resolveAnnotationKey(
  backendKey: string | undefined | null,
): string | null {
  if (!backendKey) return null;
  const trimmed = String(backendKey).trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * 比较 v1 与 v2 的一致性，供兼容期审计告警使用。
 */
export function isAnnotationKeyConsistent(
  v1: string,
  v2: string | null,
): boolean {
  if (!v2) return true;
  return v1 === v2 || v2.startsWith(v1);
}
