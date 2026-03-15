# Three-Review M1-M2 User Testing

## Primary Entry Path

1. Ensure backend is reachable on `3100`.
2. Ensure the mission worktree frontend is the instance running on `3101`.
3. Open `http://127.0.0.1:3101/`.
4. Click a project card to enter the main workspace before validating reviewer-side behavior.

## M1 Manual Success Path Checklist

1. Reach the initiation-side review surface or the nearest available designer-side review entry path.
2. Confirm the surface matches the designer-side baseline in broad structure: initiation form, selected components area, attachment area, and associated-files area.
3. Add one or more components and verify they appear exactly once in the pending review payload.
4. Fill title and reviewer assignments; verify invalid role combinations do not submit.
5. Submit the initiation flow.
6. Observe whether a stable task context is returned and whether attachment behavior waits for lineage before upload.
7. If attachments are used, verify successful uploads remain associated with the created task.

## M2 Manual Success Path Checklist

1. Reach the reviewer-facing task list or equivalent inbox entry path.
2. Confirm the inbox only shows tasks appropriate for the current reviewer role and node semantics.
3. Select a task and verify the review workspace hydrates the expected task context.
4. Trigger the primary forward action and confirm it uses the standard workflow dialog path.
5. Trigger the return action when available and confirm a reason is required.
6. After workflow mutation, verify the current task and workflow history refresh rather than staying stale.

## Cross-Area Smoke Path

Use at least one smoke path that connects the milestones:

1. Enter the app from `3101`.
2. Reach the designer-side review initiation flow.
3. Create or inspect a task that is eligible for reviewer handoff.
4. Reach the reviewer inbox path.
5. Open the same task in the reviewer workspace.
6. Perform one workflow action and confirm task context continuity across the handoff.

## Evidence to Capture

- Screenshot or observation showing the app loaded from `3101` and entered the main workspace through a project card.
- Screenshot or observation of the designer-side initiation surface and selected component state.
- Screenshot or observation of reviewer inbox visibility and task hydration into the review workspace.
- Screenshot or observation of the standard submit/return dialog path.
- Command output for focused tests and any backend smoke requests used to justify lineage or workflow claims.

## Current Readiness Caveats

- The planner confirmed the browser path is executable, but workers must ensure the frontend on `3101` is the mission worktree version when UI behavior changes.
- Some review-related surfaces may still require the worker to record the exact route or trigger they used; do not claim “manual validation passed” without naming the entry path actually exercised.

## Validation Concurrency

- `web-ui-reviewer-surface`: max concurrent validators `1`.
- Reasoning: the reviewer flow depends on shared local backend task seeds, a single frontend on `127.0.0.1:3101`, and mutable reviewer inbox/workbench state. Running more than one live validator risks task selection and workflow mutations interfering with each other.

## Flow Validator Guidance: web-ui-reviewer-surface

- Use the shared app entry at `http://127.0.0.1:3101/` and backend at `http://127.0.0.1:3100`; do not start alternate frontend/backend instances.
- Stay on the reviewer-side surface only: project card entry -> reviewer inbox -> reviewer workbench/dialogs.
- Use the top-right user switcher to select the reviewer identity that maps to backend `user-002` (`reviewer_001` / `李审核员`) before judging inbox visibility.
- Treat `task-af46d596-d792-40f8-976d-bc052fb3822b` as the primary seeded reviewer task candidate unless the live inbox clearly shows a different reviewer-visible `jd` task.
- Avoid destructive cleanup or broad workflow churn; if a required workflow action would mutate shared mission data in a way that could invalidate later assertions, report the assertion as blocked instead of improvising.
