import type { ElementSourceVersion } from '@/api/genModelV1Api';

/**
 * 语义点（P-Point / PLINE / TUBI 端点）缓存的版本令牌（#66）。gen-model `element/ptset` / `element/plines`
 * 带回本次读所钉的 `source_version`（#62），前端只取 `dbnum:sesno` 当失效键：同一库的会话一变（「取最新」、
 * 别的会话存了盘），以前按旧会话缓存的坐标一律作废，不跨版本复用。
 */
export type SourceVersionKey = `${number}:${number}`;

export function sourceVersionKey(version: ElementSourceVersion | null | undefined): SourceVersionKey | null {
  if (!version) return null;
  const { dbnum, sesno } = version;
  if (!Number.isInteger(dbnum) || dbnum < 0 || !Number.isInteger(sesno) || sesno < 0) return null;
  return `${dbnum}:${sesno}`;
}

export function parseSourceVersionKey(key: string | null | undefined): { dbnum: number; sesno: number } | null {
  const match = /^(\d+):(\d+)$/.exec(key ?? '');
  return match ? { dbnum: Number(match[1]), sesno: Number(match[2]) } : null;
}

export type SemanticPointVersionTracker = Readonly<{
  /**
   * 记下 `refno` 这次读到的版本，返回因此作废的 refno：同库、记的是别的会话的那些（含 `refno` 自己的旧记录
   * 不算——调用方马上用新数据覆盖它）。`key = null`（老服务端没有版本）不作废任何东西，也不登记。
   */
  observe(refno: string, key: string | null | undefined): string[];
  versionOf(refno: string): SourceVersionKey | null;
  /** 当前认定的某库会话；没见过为 null。 */
  currentSesno(dbnum: number): number | null;
  forget(refno: string): void;
  clear(): void;
}>;

export function createSemanticPointVersionTracker(): SemanticPointVersionTracker {
  const byRefno = new Map<string, SourceVersionKey>();
  const sesnoByDbnum = new Map<number, number>();

  function observe(refno: string, key: string | null | undefined): string[] {
    const parsed = parseSourceVersionKey(key);
    if (!parsed) return [];
    const normalized: SourceVersionKey = `${parsed.dbnum}:${parsed.sesno}`;
    const stale: string[] = [];
    if (sesnoByDbnum.get(parsed.dbnum) !== parsed.sesno) {
      for (const [other, otherKey] of byRefno) {
        if (other === refno) continue;
        const otherVersion = parseSourceVersionKey(otherKey)!;
        if (otherVersion.dbnum === parsed.dbnum && otherVersion.sesno !== parsed.sesno) stale.push(other);
      }
      for (const other of stale) byRefno.delete(other);
      sesnoByDbnum.set(parsed.dbnum, parsed.sesno);
    }
    byRefno.set(refno, normalized);
    return stale;
  }

  return Object.freeze({
    observe,
    versionOf: (refno: string) => byRefno.get(refno) ?? null,
    currentSesno: (dbnum: number) => sesnoByDbnum.get(dbnum) ?? null,
    forget: (refno: string) => { byRefno.delete(refno); },
    clear: () => {
      byRefno.clear();
      sesnoByDbnum.clear();
    },
  });
}
