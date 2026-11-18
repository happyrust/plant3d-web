/**
 * 「取最新」自己的登记表：不经 `showModelByRefno` 装进场景的东西——整库显示（`show_dbnum`）和地址栏直装
 * （`show_refno` / `debug_refno`）。它们不进已加载节点表（那张表每登记一个节点就问一次节点模型状态、行上出新旧标记，
 * 整库显示几十个 SITE 一起登记会改变装载时的行为），所以取最新另记一份「装了谁、装的时候库在哪个会话」。
 *
 * 节点一旦被取最新重载过，就由已加载节点表接管（重载走的是 `showModelByRefno`，它会登记），从这里撤掉。
 * 模块级单例：整库显示在显示流程里登记、地址栏直装在查看器里登记，取最新在状态栏里读。
 */
import { toRefnoKey } from '@/utils/refnoKey';

export type GetWorkWatermark = { modelSesno: number | null; fileLatestSesno: number | null };

export type GetWorkRegisteredRoot = {
  /** `a_b` */
  refno: string;
  dbnum: number;
  loadedModelSesno: number | null;
  loadedFileLatestSesno: number | null;
  origin: 'show_dbnum' | 'show_refno' | 'debug_refno';
};

export type GetWorkRegisteredScope = {
  dbnum: number;
  knownSites: Set<string>;
  discover: boolean;
  checkedFileLatestSesno: number | null;
};

const roots = new Map<string, GetWorkRegisteredRoot>();
const scopes = new Map<number, GetWorkRegisteredScope>();

/** 登记一个直接装进场景的节点。`at` 是开始装之前读到的库水位（取早不取晚）。 */
export function noteGetWorkRoot(
  refno: string,
  dbnum: number,
  at: GetWorkWatermark,
  origin: GetWorkRegisteredRoot['origin'],
): void {
  const key = toRefnoKey(refno);
  if (!key || !Number.isFinite(dbnum) || dbnum <= 0) return;
  roots.set(key, { refno: key, dbnum, loadedModelSesno: at.modelSesno, loadedFileLatestSesno: at.fileLatestSesno, origin });
}

/** 核对过、不用动：把这个节点记的水位推进到现在。不在表里的不管。 */
export function advanceGetWorkRoot(refno: string, at: GetWorkWatermark): void {
  const entry = roots.get(toRefnoKey(refno));
  if (!entry) return;
  entry.loadedModelSesno = at.modelSesno;
  entry.loadedFileLatestSesno = at.fileLatestSesno;
}

export function forgetGetWorkRoot(refno: string): void {
  roots.delete(toRefnoKey(refno));
}

/**
 * 登记一次整库显示。`sites`：这个库里已经在管的顶层 SITE（装进来的，和没收齐、不归取最新管的）；
 * `discover`：以后要不要找新出现的 SITE（按预算只显示了一部分的库传 `false`）。同一个库再显示一次，名单合并。
 */
export function noteGetWorkDbnumScope(
  dbnum: number,
  scope: { sites: readonly string[]; discover: boolean; fileLatestSesno: number | null },
): void {
  if (!Number.isFinite(dbnum) || dbnum <= 0) return;
  const existing = scopes.get(dbnum);
  const knownSites = existing?.knownSites ?? new Set<string>();
  for (const site of scope.sites) {
    const key = toRefnoKey(site);
    if (key) knownSites.add(key);
  }
  scopes.set(dbnum, { dbnum, knownSites, discover: scope.discover, checkedFileLatestSesno: scope.fileLatestSesno });
}

export function noteGetWorkSiteKnown(dbnum: number, site: string): void {
  const key = toRefnoKey(site);
  if (key) scopes.get(dbnum)?.knownSites.add(key);
}

export function noteGetWorkScopeChecked(dbnum: number, fileLatestSesno: number | null): void {
  const scope = scopes.get(dbnum);
  if (scope) scope.checkedFileLatestSesno = fileLatestSesno;
}

export function getWorkRegisteredRoots(): GetWorkRegisteredRoot[] {
  return [...roots.values()].map((entry) => ({ ...entry }));
}

export function getWorkRegisteredScopes(): GetWorkRegisteredScope[] {
  return [...scopes.values()].map((scope) => ({ ...scope, knownSites: new Set(scope.knownSites) }));
}

/** 场景清空 / 查看器卸载：整张表撤掉。 */
export function resetGetWorkRegistry(): void {
  roots.clear();
  scopes.clear();
}
