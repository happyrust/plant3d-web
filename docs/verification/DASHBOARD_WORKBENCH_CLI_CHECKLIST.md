# Dashboard Workbench CLI Checklist

适用场景：
- dashboard 全局工作台联调
- `plant3d-web` 与 `plant-model-gen` 跨仓接口契约核查
- 不希望新增一次性测试文件时的手工/CLI 验证

推荐直接执行：

```bash
npm run verify:dashboard
```

如需复用现有二进制加速：

```bash
bash scripts/verify-dashboard-workbench.sh --skip-build
```

## 1. 前端静态检查

在 `plant3d-web` 根目录执行：

```bash
npm run type-check
./node_modules/.bin/eslint \
  src/api/dashboardApi.ts \
  src/api/genModelTaskApi.ts \
  src/components/dashboard/DashboardLayout.vue \
  src/components/dashboard/DashboardOverview.vue \
  src/components/dashboard/DashboardReviewsPanel.vue \
  src/composables/dashboardRecentProjects.ts \
  src/composables/useDashboardWorkbench.ts \
  src/composables/useModelProjects.ts \
  src/types/task.ts \
  --ext .vue,.ts
```

预期：
- `type-check` 通过
- `eslint` 无报错输出

## 2. 编译并启动后端服务

在 `plant3d-web` 根目录执行：

```bash
CARGO_BUILD_JOBS=1 cargo build \
  --manifest-path ../plant-model-gen/Cargo.toml \
  --features web_server \
  --bin web_server
```

在 `plant-model-gen` 根目录执行：

```bash
./target/debug/web_server --config db_options/DbOption-mac
```

预期：
- 服务启动在 `http://127.0.0.1:3100`
- 日志中出现 Web UI 服务器启动成功

## 3. 校验核心接口

在 `plant3d-web` 根目录执行：

```bash
curl -i -sS 'http://127.0.0.1:3100/api/projects'
curl -i -sS 'http://127.0.0.1:3100/api/status'
curl -i -sS 'http://127.0.0.1:3100/api/dashboard/activities?limit=5'
```

预期：
- `/api/projects` 返回 `200`
- 项目项包含 `show_dbnum`
- `/api/status` 返回 `database_connected` / `surrealdb_connected`
- `/api/dashboard/activities` 返回 `200`，即使没有数据也应是 `{"success":true,"data":[]}`

## 4. 用真实数据验证 activities 字段映射

向 SurrealDB 注入一条最小校审流转记录：

```bash
printf "%s\n" \
  "CREATE review_workflow_history CONTENT { task_id: 'dashboard-cli-check', action: 'submit', node: 'sj', operator_id: 'cli-user', operator_name: 'CLI 验证', comment: '通过 CLI 注入的验证记录', timestamp: d'2026-03-13T17:56:30Z' };" \
  | surreal sql -e ws://127.0.0.1:8020 -u root -p root --ns 1516 --db AvevaMarineSample --json --hide-welcome
```

再次请求：

```bash
curl -sS 'http://127.0.0.1:3100/api/dashboard/activities?limit=5'
```

预期返回至少包含一条：

```json
{
  "id": "review:dashboard-cli-check:1773424590000",
  "source": "review",
  "userId": "cli-user",
  "userName": "CLI 验证",
  "userType": "human",
  "actionTitle": "提交了校审任务",
  "targetName": "dashboard-cli-check",
  "actionDesc": "通过 CLI 注入的验证记录",
  "createdAt": "2026-03-13T17:56:30Z"
}
```

## 5. 清理验证数据

```bash
printf "%s\n" \
  "DELETE review_workflow_history WHERE task_id = 'dashboard-cli-check';" \
  | surreal sql -e ws://127.0.0.1:8020 -u root -p root --ns 1516 --db AvevaMarineSample --json --hide-welcome

curl -sS 'http://127.0.0.1:3100/api/dashboard/activities?limit=5'
```

预期：
- 查询结果恢复为空，或不再包含 `dashboard-cli-check`

## 6. 本次已验证的关键点

- `dashboard` 不再依赖虚构的 `summary/tasks` 接口
- `/api/dashboard/activities` 已接入后端并返回 camelCase 字段
- `/api/projects` 已包含 `show_dbnum`
- `/api/status` 已可支撑前端数据库/系统状态卡片
- activities 可通过真实数据库数据完成联调验证
