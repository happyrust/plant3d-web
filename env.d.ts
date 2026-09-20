/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_REVIEW_ENABLE_INTERNAL_WORKFLOW_MODE?: string;
  /** 仅开发环境：后端网络失败时是否允许使用本地校审 mock；生产构建始终禁用 */
  readonly VITE_REVIEW_ALLOW_MOCK_FALLBACK?: string;
  /** gen-model `/api/v1` 直连地址（默认 http://localhost:8022）或 `/gm` 同源代理前缀 */
  readonly VITE_GEN_MODEL_V1_BASE_URL?: string;
  /** dev `/gm` 与同源 `/api` 代理的上游（仅 vite.config.ts 读） */
  readonly VITE_GEN_MODEL_V1_PROXY_TARGET?: string;
}

/** 由 vite.config 在构建/开发时注入（与后端 Version 接口字段语义对齐） */
declare const __FRONTEND_APP_VERSION__: string;
declare const __FRONTEND_GIT_COMMIT__: string;
declare const __FRONTEND_BUILD_ISO__: string;
