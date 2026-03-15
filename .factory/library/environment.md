# Three-Review M1-M2 Environment

## Repository Paths

- Frontend mission worktree: `/Volumes/DPC/work/plant-code/plant3d-web/.worktrees/mission-review-m1-m2`
- Dirty root checkout (off-limits for implementation): `/Volumes/DPC/work/plant-code/plant3d-web`
- Backend repo: `/Volumes/DPC/work/plant-code/plant-model-gen`
- Mission dir: `/Users/dongpengcheng/.factory/missions/4d7bd249-b8ec-4d5d-9033-77ef2ded8396`

## Ports

- Backend API: `127.0.0.1:3100`
- Frontend Vite dev server: `127.0.0.1:3101`

Do not take over unrelated observed ports such as `5000`, `7000`, `5173`, or `8020`.

## Service Commands

- Backend start:
  `DB_OPTION_FILE=/Volumes/DPC/work/plant-code/plant-model-gen/db_options/DbOption-mac.toml WEB_SERVER_PORT=3100 cargo run --manifest-path /Volumes/DPC/work/plant-code/plant-model-gen/Cargo.toml --bin web_server --features web_server`
- Frontend start from mission worktree:
  `npm --prefix /Volumes/DPC/work/plant-code/plant3d-web/.worktrees/mission-review-m1-m2 run dev -- --host 127.0.0.1 --port 3101 --strictPort`

## Validation Commands

- Install worktree dependencies if needed:
  `npm --prefix /Volumes/DPC/work/plant-code/plant3d-web/.worktrees/mission-review-m1-m2 install`
- Type-check:
  `npm --prefix /Volumes/DPC/work/plant-code/plant3d-web/.worktrees/mission-review-m1-m2 run type-check`
- Focused M1 tests:
  `cd /Volumes/DPC/work/plant-code/plant3d-web/.worktrees/mission-review-m1-m2 && npx vitest run src/api/reviewApi.test.ts src/composables/useUserStore.createReviewTask.test.ts src/components/review/reviewAttachmentFlow.test.ts`
- Focused M2 tests:
  `cd /Volumes/DPC/work/plant-code/plant3d-web/.worktrees/mission-review-m1-m2 && npx vitest run src/components/review/reviewerTaskListActions.test.ts src/components/review/reviewPanelActions.test.ts src/api/reviewApi.test.ts src/composables/useReviewStore.websocket.test.ts`
- Read-only M1 lint:
  `cd /Volumes/DPC/work/plant-code/plant3d-web/.worktrees/mission-review-m1-m2 && npx eslint src/components/review/InitiateReviewPanel.vue src/components/review/FileUploadSection.vue src/components/review/AssociatedFilesList.vue src/composables/useUserStore.ts src/api/reviewApi.ts`
- Read-only M2 lint:
  `cd /Volumes/DPC/work/plant-code/plant3d-web/.worktrees/mission-review-m1-m2 && npx eslint src/components/review/ReviewerTaskList.vue src/components/review/WorkflowSubmitDialog.vue src/components/review/WorkflowReturnDialog.vue src/components/review/ReviewPanel.vue src/composables/useReviewStore.ts src/composables/useUserStore.ts src/api/reviewApi.ts`
- Browser smoke scripts:
  `cd /Volumes/DPC/work/plant-code/plant3d-web/.worktrees/mission-review-m1-m2 && node validation-test.mjs`
  `cd /Volumes/DPC/work/plant-code/plant3d-web/.worktrees/mission-review-m1-m2 && node validation-navigation-test.mjs`

## Known Starting State

- Planning dry run proved that `3100` and `3101` are both reachable locally
- `GET /api/review/tasks` returned live review task data during planning
- `npm run type-check` and representative review-focused Vitest passed in the root checkout
- The root checkout currently has another `plant3d-web` instance that may already occupy `3101`; workers must ensure validation runs against the mission worktree version when UI behavior changes
- The repository lint script uses `--fix`, so it is not the default validation command for this mission

## Worker Guidance

- Use the mission worktree for all implementation and validation commands
- Use absolute paths when touching the backend repo from the frontend worktree
- Stop background services you start unless a validator explicitly reuses them
- If the worktree lacks `node_modules`, install them there before claiming validation is blocked
