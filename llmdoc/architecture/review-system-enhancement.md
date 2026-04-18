# 编校审系统增强架构

## 概述

本文档描述了编校审系统的五阶段增强实现，包括多级审批流程、JWT认证、附件管理、数据同步和辅助校审数据接入。

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                      前端 (plant3d-web)                      │
├─────────────────────────────────────────────────────────────┤
│  reviewApi.ts          │  useScreenshot.ts                  │
│  - Token 管理          │  - 截图捕获                         │
│  - 审批流程 API        │  - 上传功能                         │
│  - 附件上传/删除       │                                     │
│  - 数据同步            │                                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   后端 (gen-model-fork)                      │
├─────────────────────────────────────────────────────────────┤
│  jwt_auth.rs           │  review_api.rs                     │
│  - Token 生成/验证     │  - 审批流程处理                     │
│  - 中间件              │  - 附件管理                         │
│  - 角色验证            │  - 数据同步                         │
├─────────────────────────────────────────────────────────────┤
│  review_integration.rs                                      │
│  - 辅助校审数据 (碰撞检测等)                                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      SurrealDB                               │
│  - review_tasks 表                                          │
│  - review_attachments 表                                    │
│  - collision_events 表                                      │
└─────────────────────────────────────────────────────────────┘
```

## 第一阶段：多级审批流程

### 工作流节点

| 节点 | 代码 | 角色 | 说明 |
|------|------|------|------|
| 编制 | sj | 设计人员 | 创建编校审单，提交审核 |
| 校对 | jd | 校对人员 | 校对设计内容 |
| 审核 | sh | 审核人员 | 审核校对结果 |
| 批准 | pz | 批准人员 | 最终批准 |

### 流程状态转换

```
draft → submitted → in_review → approved
                  ↘ rejected (可驳回到任意前序节点)
```

### API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/review/tasks/{id}/submit` | 提交到下一节点 |
| POST | `/api/review/tasks/{id}/return` | 驳回到指定节点 |
| GET | `/api/review/tasks/{id}/workflow` | 获取工作流历史 |

## 第二阶段：JWT 认证

### 配置

JWT 配置从 `DbOption.toml` 的 `[model_center]` 节读取：

```toml
[model_center]
token_secret = "your-secret-key"
token_expiration_hours = 24
```

### Token Claims 结构

```typescript
interface TokenClaims {
  project_id: string;  // 项目号
  user_id: string;     // 用户ID
  form_id: string;     // 表单ID
  role?: string;       // 角色 (admin/sj/jd/sh/pz)
  exp: number;         // 过期时间戳
  iat: number;         // 签发时间戳
}
```

### API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/token` | 获取 JWT Token |
| POST | `/api/auth/verify` | 验证 Token |

### 前端使用

```typescript
import { login, getAuthToken, isLoggedIn } from '@/api/reviewApi';

// 登录
await login('projectId', 'userId', 'sj');

// 检查登录状态
if (isLoggedIn()) {
  // 已登录，API 请求会自动携带 Token
}
```

## 第三阶段：附件与截图管理

### 附件 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/review/attachments` | 上传附件 (multipart/form-data) |
| DELETE | `/api/review/attachments/{id}` | 删除附件 |

### 附件存储

附件存储在 `assets/review_attachments/` 目录，通过静态文件服务访问：
- URL: `/files/review_attachments/{filename}`

### 截图 Composable

```typescript
import { useScreenshot } from '@/composables/useScreenshot';

const { captureAndUpload, captureAndDownload } = useScreenshot();

// 截图并上传
const attachment = await captureAndUpload(taskId);

// 截图并下载
await captureAndDownload('screenshot.png');
```

## 第四阶段：数据同步接口

### API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/review/sync/export` | 导出校审数据 |
| POST | `/api/review/sync/import` | 导入校审数据 |

### 导出请求

```typescript
const result = await reviewSyncExport({
  taskIds: ['task1', 'task2'],  // 可选，不传则导出全部
  includeAttachments: true,
  includeComments: true,
  includeRecords: true,
});
```

### 导入请求

```typescript
const result = await reviewSyncImport({
  tasks: exportedTasks,
  overwrite: false,  // 是否覆盖已存在的任务
});
```

## 第五阶段：辅助校审数据接入

### 碰撞检测数据 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/review/collision-data` | 查询碰撞数据 |
| POST | `/api/review/aux-data` | 获取辅助数据 (需认证) |

### 碰撞数据查询参数

```typescript
interface CollisionQueryParams {
  project_id?: string;  // 项目ID
  refno?: string;       // 元件 refno
  limit?: number;       // 分页大小 (默认 100)
  offset?: number;      // 分页偏移
}
```

### 碰撞数据响应

```typescript
interface CollisionItem {
  ObjectOneLoc: string;    // 对象1位置
  ObjectOne: string;       // 对象1 refno
  ObjectTowLoc: string;    // 对象2位置
  ObjectTow: string;       // 对象2 refno
  ErrorMsg: string;        // 错误信息
  ObjectOneMajor: string;  // 对象1专业
  ObjectTwoMajor: string;  // 对象2专业
  CheckUsr: string;        // 检查人
  CheckDate: string;       // 检查日期
  ErrorStatus: string;     // 状态 (pending/resolved)
}
```

## 相关文件

### 后端 (gen-model-fork)

| 文件 | 说明 |
|------|------|
| `src/web_api/jwt_auth.rs` | JWT 认证模块 |
| `src/web_api/review_api.rs` | 校审 API 主模块 |
| `src/web_api/review_integration.rs` | 辅助数据集成 |
| `src/web_server/mod.rs` | 路由配置 |

### 前端 (plant3d-web)

| 文件 | 说明 |
|------|------|
| `src/api/reviewApi.ts` | 校审 API 客户端 |
| `src/composables/useScreenshot.ts` | 截图功能 |
| `src/types/auth.ts` | 类型定义 |