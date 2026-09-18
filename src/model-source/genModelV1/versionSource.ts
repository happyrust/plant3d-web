/**
 * `gen-model-v1` 的模型版本取数（ADR 0065 / gen-model-refactor ADR-081；plan 2026-09-18 §2 / §3）。
 *
 * 阶段 A1 只立端口：`listVersions` 要等后端 `GET /api/v1/model/versions`（A2），`loadVersion` 走
 * `model/history/generate → tasks → history/query tool=instances`（A3）；两者接入前抛一个说得清的错，
 * 版本对比面板把它原样显示。`pinLatestEnvironment` 现在就是终态：环境 = 视口里已加载的模型，
 * 重钉不带任何 pin，DTX 加载器按页面级开关走 records + forceRefresh（CONTEXT「最新环境模型」，Q12）。
 */
import type { ModelVersionEnvironmentPin, ModelVersionGeometry, ModelVersionSource } from '../ports';

export class GenModelV1ModelVersionsNotReadyError extends Error {
  constructor(what: 'listVersions' | 'loadVersion') {
    super(
      `gen-model-v1 下的版本对比尚未接入（${what}）：需要 gen-model-refactor 的 GET /api/v1/model/versions 与历史投影取数，`
      + '见 docs/plans/2026-09-18-model-version-compare-gen-model-v1-migration-plan.md §5 A2 / A3；'
      + '现阶段请用 ?model_source=legacy 打开版本对比。',
    );
    this.name = 'GenModelV1ModelVersionsNotReadyError';
  }
}

export function createGenModelV1ModelVersionSource(): ModelVersionSource {
  return {
    async listVersions() {
      throw new GenModelV1ModelVersionsNotReadyError('listVersions');
    },
    async loadVersion(): Promise<ModelVersionGeometry> {
      throw new GenModelV1ModelVersionsNotReadyError('loadVersion');
    },
    async pinLatestEnvironment(): Promise<ModelVersionEnvironmentPin> {
      return { generatedAt: null, loaderOptions: {} };
    },
  };
}
