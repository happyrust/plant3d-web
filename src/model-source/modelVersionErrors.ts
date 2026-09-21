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
 * 服务端是旧构建、没有这条路由（axum 无信封的 404）。节点版本视图（ADR 0066）的四条新路由
 * `element/attribute-history` / `element/attribute-diff` / `node/versions` / `node/diff-summary` 都可能撞上它：
 * 面板据此回落到现有路由能给的那一半，并照实说「要新版服务端」，而不是把它当成「没有变化」。
 */
export class ModelVersionRouteUnavailableError extends Error {
  readonly route: string;

  constructor(route: string) {
    super(`服务端还没有 ${route}：这一块要带该路由的新版服务端`);
    this.name = 'ModelVersionRouteUnavailableError';
    this.route = route;
  }
}
