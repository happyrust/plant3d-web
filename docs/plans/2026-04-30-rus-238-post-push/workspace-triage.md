# RUS-238 后续工作区收敛盘点

> 目标：把当前大规模脏工作区与 RUS-238 后续验收隔离，避免后续补丁混入无关变更。

## 当前状态快照

执行命令：

```bash
git status --porcelain=v1 | awk '{status[$1]++} END {for (s in status) print s, status[s]}' | sort
```

结果：

| 状态 | 数量 | 说明 |
| --- | ---: | --- |
| `M` | 95 | 已跟踪文件修改 |
| `D` | 31 | 已跟踪文件删除 |
| `??` | 76 | 未跟踪文件或目录 |

RUS-238 post-push 规划文件当前仍未提交：

```text
?? docs/plans/2026-04-30-rus-238-post-push-next-plan.md
?? docs/plans/2026-04-30-rus-238-post-push/
```

## 收敛原则

- 不使用 `git add .` 或 `git add -A`。
- 不删除未跟踪文件，除非明确确认它们是临时产物。
- 不把 PMS、批注、空间查询、配置、文档归档等不同主题混入同一提交。
- RUS-238 后续验收补丁只允许包含测量路径相关文件和对应文档。

## 建议分组

### 1. RUS-238 后续规划

范围：

- `docs/plans/2026-04-30-rus-238-post-push-next-plan.md`
- `docs/plans/2026-04-30-rus-238-post-push/`

建议：

- 若需要保留规划成果，可单独提交为 `docs(measurement): 补充 RUS-238 推送后验收计划`。
- 若只作为本地执行工作台，可暂不提交。

当前计数：

| 状态 | 数量 |
| --- | ---: |
| `??` | 2 |

### 2. PMS / 编校审联调

典型范围：

- `pms-review-simulator.html`
- `scripts/pms-*`
- `src/debug/pmsReviewSimulator*`
- `docs/verification/*PMS*`
- `docs/plans/*pms*`

建议：

- 单独整理为 PMS 联调或 RUS-241 相关任务。
- 与 RUS-238 测量路径验收只通过验收记录关联，不混入代码提交。

当前计数：

| 状态 | 数量 |
| --- | ---: |
| `M` | 14 |
| `??` | 38 |

### 3. 批注 / Review UI

典型范围：

- `src/components/review/*`
- `src/review/*`
- `src/composables/useReviewStore*`
- 相关测试文件

建议：

- 先按功能拆分：批注截图、评论线程、确认记录恢复、Dock 面板等。
- 对于已经部分暂存过的文件，后续继续使用 partial staging。

当前计数：

| 状态 | 数量 |
| --- | ---: |
| `M` | 34 |
| `??` | 4 |

### 4. 空间查询 / DTX / Viewer

典型范围：

- `src/components/spatial-query/*`
- `src/api/genModelSpatialApi*`
- `src/viewer/dtx/*`
- `src/utils/three/dtx/*`
- `ui/空间查询/*`

建议：

- 与 RUS-238 无直接关系，单独作为空间查询或 Viewer 任务处理。

当前计数：

| 状态 | 数量 |
| --- | ---: |
| `M` | 8 |

### 5. 配置 / 临时产物 / 文档归档

典型范围：

- `.cursor/*`
- `.tmp/*`
- `.planning/*`
- `.playwright-mcp/*`
- `llmdoc/*`
- `history.txt`

建议：

- 先确认哪些是用户需要保留的本地状态。
- 临时产物若要清理，必须单独确认后再删除。

## 下一步动作

1. RUS-238 验收输入到位前，不再扩大测量路径代码改动。
2. 若用户要求提交规划文件，只提交 RUS-238 post-push 规划目录和 `post-push-next-plan.md`。
3. 若用户要求收敛脏工作区，先按上面 5 组逐组列 diff，再分别决定保留、提交或清理。
