/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_REVIEW_ENABLE_INTERNAL_WORKFLOW_MODE?: string;
}

/** 由 vite.config 在构建/开发时注入（与后端 Version 接口字段语义对齐） */
declare const __FRONTEND_APP_VERSION__: string;
declare const __FRONTEND_GIT_COMMIT__: string;
declare const __FRONTEND_BUILD_ISO__: string;
declare const __DUCKDB_ASSET_VERSION__: string;
