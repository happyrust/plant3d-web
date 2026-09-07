# M2 Restore Validation Bootstrap

This tracked artifact is the source of truth for the M2 restore-validation bootstrap. It exists so later scrutiny and user-testing validators can read a single M2-scoped setup instead of inferring restore fixtures from the unrelated M6/M7 collaboration pack.

## Tracked Bootstrap Assets

- `debug_scripts/review_demo_seed.py`
- `debug_scripts/review_demo_seed_test.py`
- `docs/verification/m2-restore-bootstrap.md`
- `.factory/library/m2-restore-bootstrap.md`

## Seed Command

```bash
python debug_scripts/review_demo_seed.py --pretty
```

- Default backend target: `http://127.0.0.1:3100`
- Plan-only inspection: `python debug_scripts/review_demo_seed.py --print-plan --pretty`
- The seed output includes `discoverability.m2Restore` with the exact task IDs, form IDs, and embed route hint used below.

## M2 Restore Scenarios

### 1. Reviewer task with confirmed records

- Task ID: `seed-m2-reviewer-confirmed`
- Form ID: `FORM-M2-RESTORE-001`
- Reviewer query: `http://127.0.0.1:3100/api/review/tasks?checker_id=user-002`
- Frontend reviewer identity: switch to alias `reviewer_001` (maps to backend `user-002`)

Expected seeded evidence:

- one confirmed text annotation: `seed-m2-text-annotation-1`
- one confirmed measurement: `seed-m2-measurement-1`
- record ID: `seed-record-m2-confirmed`

Validation use:

1. Seed the data.
2. Open the reviewer inbox as `reviewer_001`.
3. Select `seed-m2-reviewer-confirmed`.
4. Confirm the workbench restore path replays the confirmed annotation/measurement state.

### 2. Empty-task clearing after seeded task

- Task ID: `seed-m2-empty-after-confirmed`
- Form ID: `FORM-M2-RESTORE-EMPTY-001`
- Reviewer query: `http://127.0.0.1:3100/api/review/tasks?checker_id=user-002`

Seeded characteristics:

- no confirmed records
- no comments
- intentionally empty component list (`skipComponentHydration=true`) so validators can verify the empty restore branch directly

Validation use:

1. First open `seed-m2-reviewer-confirmed` and let the confirmed state render.
2. Then switch to `seed-m2-empty-after-confirmed`.
3. Confirm the scene clears and no stale confirmed overlays remain.

### 3. formId-backed embed restore

- Task ID: `seed-m2-embed-restore`
- Form ID: `FORM-M2-EMBED-001`
- Reviewer query: `http://127.0.0.1:3100/api/review/tasks?checker_id=user-002`
- Embed route hint:

```text
/?user_token=<token>&workflow_role=jd&workflow_mode=external&form_id=FORM-M2-EMBED-001
```

- Embed token mint request:

```json
{
  "project_id": "debug-project",
  "user_id": "user-002",
  "workflow_role": "jd",
  "workflow_mode": "external",
  "form_id": "FORM-M2-EMBED-001"
}
```

Seeded evidence:

- confirmed record ID: `seed-record-m2-embed`
- one confirmed cloud annotation: `seed-m2-cloud-annotation-1`

Validation use:

1. Seed the data.
2. Mint a valid embed token with `POST /api/review/embed-url` using the JSON payload above.
3. Read `execution.m2EmbedRuntime.response.localOpenUrl` from `python debug_scripts/review_demo_seed.py --pretty` for a ready-to-open local URL, or replace `<token>` in the route hint with `execution.m2EmbedRuntime.response.token`.
4. Confirm `execution.m2EmbedRuntime.workflowSyncProbe` reports `formExists=true`, `taskCreated=true`, `taskId=seed-m2-embed-restore`, and `recordCount=1`.
5. Open the app with the generated local URL and confirm workflow-sync restore resolves `FORM-M2-EMBED-001` and replays the seeded cloud annotation.

### Browser-safe local launch helper

When validators need a copy/paste-safe path without shell escaping, use the tracked PMS simulator:

1. Open `http://127.0.0.1:3101/pms-review-simulator.html?output_project=AvevaMarineSample`.
2. Keep the default **token-primary** launch mode (turn off “真实 PMS 拼链” if needed).
3. Click **新增** or **重开最近 form_id** after seeding.
4. Copy the **最终 iframe src** shown in the right-side diagnostics card and open that URL directly in the browser.

The simulator now emits a browser-safe token launch URL that preserves:

- `user_token`
- `form_id=FORM-M2-EMBED-001`
- `workflow_mode=external`
- `workflow_role=jd`

This avoids manual shell/query escaping while still exercising the same minted embed token/session used by `POST /api/review/embed-url`.

## CLI Discoverability Checks

These checks are what later validators can run directly after seeding:

```bash
python debug_scripts/review_demo_seed.py --print-plan --pretty
python debug_scripts/review_demo_seed_test.py
python debug_scripts/review_demo_seed.py --pretty
curl "http://127.0.0.1:3100/api/review/tasks?checker_id=user-002"
```

What to look for:

- `discoverability.m2Restore.reviewerConfirmedTaskId == seed-m2-reviewer-confirmed`
- `discoverability.m2Restore.emptyTaskId == seed-m2-empty-after-confirmed`
- `discoverability.m2Restore.embedFormId == FORM-M2-EMBED-001`
- `discoverability.m2Restore.embedMintRequest.userId == user-002`
- `execution.m2EmbedRuntime.response.localOpenUrl` contains `form_id=FORM-M2-EMBED-001`
- `execution.m2EmbedRuntime.workflowSyncProbe.recordCount == 1`

## Relationship To M6/M7 Pack

The existing `docs/verification/m6-m7-demo-seed-pack.md` remains the source of truth for collaboration and later-milestone fixtures. This document is the M2-specific bootstrap overlay for restore validation only.
