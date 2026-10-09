/** 校审快照的模型版本上下文；不保存场景矩阵、几何缓存或用户令牌。 */
export type ReviewModelContext = {
  schemaVersion: 1;
  project: string;
  dbnum: number | null;
  taskId: string;
  formId: string;
  node: string;
  comparison: null | {
    dbnum: number;
    refno: string;
    a: number;
    b: number;
    units: { refno: string; a: number; b: number }[];
    viewMode: 'single' | 'split';
    activeSide: 'before' | 'after';
    diffOnly: boolean;
  };
};

export function isReviewModelContext(value: unknown): value is ReviewModelContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const context = value as ReviewModelContext;
  const positive = (number: unknown) => typeof number === 'number' && Number.isSafeInteger(number) && number > 0;
  const refno = (text: unknown) => typeof text === 'string' && /^\d+[_/]\d+$/.test(text);
  if (context.schemaVersion !== 1 || !['project', 'taskId', 'formId'].every(key => typeof context[key as keyof ReviewModelContext] === 'string' && String(context[key as keyof ReviewModelContext]).trim())
    || !['sj', 'jd', 'sh', 'pz'].includes(context.node) || (context.dbnum !== null && !positive(context.dbnum))) return false;
  const comparison = context.comparison;
  if (comparison === null) return true;
  return !!comparison && typeof comparison === 'object' && positive(comparison.dbnum) && refno(comparison.refno)
    && positive(comparison.a) && positive(comparison.b) && comparison.a < comparison.b
    && ['single', 'split'].includes(comparison.viewMode) && ['before', 'after'].includes(comparison.activeSide)
    && typeof comparison.diffOnly === 'boolean' && Array.isArray(comparison.units)
    && comparison.units.every(unit => unit && refno(unit.refno) && positive(unit.a) && positive(unit.b) && unit.a < unit.b)
    && new Set(comparison.units.map(unit => unit.refno.replace(/\//g, '_'))).size === comparison.units.length;
}

/** JSON 对象字段顺序不参与版本上下文是否相同的判断。 */
export function reviewModelContextKey(context: ReviewModelContext): string {
  const comparison = context.comparison;
  return JSON.stringify([context.schemaVersion, context.project, context.dbnum, context.taskId, context.formId, context.node,
    comparison ? [comparison.dbnum, comparison.refno.replace(/\//g, '_'), comparison.a, comparison.b,
      comparison.units.map(unit => [unit.refno.replace(/\//g, '_'), unit.a, unit.b]).sort(),
      comparison.viewMode, comparison.activeSide, comparison.diffOnly] : null]);
}

/** 同一几何版本的记录可分组；节点和保存时的查看方式不改变模型版本。 */
export function reviewModelVersionKey(context: ReviewModelContext): string {
  return reviewModelContextKey({ ...context, node: 'sj', comparison: context.comparison
    ? { ...context.comparison, viewMode: 'single', activeSide: 'after', diffOnly: false } : null });
}
