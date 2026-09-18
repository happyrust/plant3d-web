/**
 * 版本对比取数（`ModelVersionSource`）的领域错误。运行时代码，所以不在只放类型的 `ports.ts` 里。
 */

/**
 * 参考号不是最小交付单元根。哪些类型算最小交付单元以后端项目配置为唯一口径（CONTEXT「最小交付单元」，Q6）：
 * gen-model-v1 适配器从 422 `NOT_A_DELIVERY_UNIT_ROOT` 的 `detail` 翻译出来；前端不再持类型清单。
 */
export class NotDeliveryUnitRootError extends Error {
  readonly unitRefno: string;
  readonly noun: string;
  readonly deliveryUnitTypes: readonly string[];

  constructor(unitRefno: string, noun: string, deliveryUnitTypes: readonly string[]) {
    const types = deliveryUnitTypes.length > 0 ? deliveryUnitTypes.join(' / ') : '未知';
    super(`参考号 ${unitRefno} 不是最小交付单元根：${noun || 'UNKNOWN'}（项目配置的类型集：${types}）`);
    this.name = 'NotDeliveryUnitRootError';
    this.unitRefno = unitRefno;
    this.noun = noun;
    this.deliveryUnitTypes = [...deliveryUnitTypes];
  }
}

/**
 * `model_source=legacy` 下的版本对比已退役（2026-09-18，ADR 0065；plan 2026-09-18 §7）：legacy 的
 * `/api/model/units/{refno}/versions` 与不可变 parquet manifest 那条取数链删掉了，模型版本只从 gen-model-v1 取。
 * legacy 适配器的 `versions` 只剩这一句话，让面板给出明确的空态而不是白屏。
 */
export class LegacyModelVersionsRetiredError extends Error {
  constructor() {
    super('legacy 数据源的版本对比已退役：去掉 ?model_source=legacy（或改为 model_source=gen-model-v1）后再打开版本对比');
    this.name = 'LegacyModelVersionsRetiredError';
  }
}
