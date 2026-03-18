# M6+M7 Demo Seed Pack

This document describes the deterministic seed inventory used for the M6+M7 reviewer/designer validation mission.

## Entry Point

```bash
python3 scripts/review_demo_seed.py --pretty
```

- The command targets the shared local backend at `http://127.0.0.1:3100` by default.
- Use `python3 scripts/review_demo_seed.py --print-plan --pretty` to inspect the canonical pack shape without touching the backend.
- The script uses `POST /api/review/sync/import` with `overwrite: true` for task refresh and then attempts to sync confirmation records and annotation comments through the existing review APIs.

## Deterministic Inventory

The seed key is `m6-m7-review-demo-pack-v1`. It creates or refreshes these scenarios:

1. `text-annotation` -> `seed-m6-text-annotation` / `FORM-M6-TEXT-001`
2. `cloud-annotation` -> `seed-m6-cloud-annotation` / `FORM-M6-CLOUD-001`
3. `rectangle-annotation` -> `seed-m6-rectangle-annotation` / `FORM-M6-RECT-001`
4. `measurement-replay` -> `seed-m6-measurement-replay` / `FORM-M6-MEASURE-001`
5. `task-thread-collaboration` -> `seed-m7-task-thread` / `FORM-M7-TASK-THREAD-001`
6. `annotation-thread-collaboration` -> `seed-m7-annotation-thread` / `FORM-M7-ANNOTATION-THREAD-001`
7. `return-resubmit-reopen` -> `seed-m6m7-return-resubmit` / `FORM-M6M7-LOOP-001`

Shared seeded identities:

- designer frontend/backend: `designer_001`
- reviewer frontend alias: `reviewer_001`
- reviewer backend user: `user-002`
- approver frontend/backend: `manager_001`

## Discoverability

After a successful live seed run, validators can locate the seeded tasks without direct database inspection:

- Reviewer inbox query: `http://127.0.0.1:3100/api/review/tasks?checker_id=user-002`
- Designer task query: `http://127.0.0.1:3100/api/review/tasks?requester_id=designer_001`
- Approver task query: `http://127.0.0.1:3100/api/review/tasks?approver_id=manager_001`

In the frontend, switch to reviewer alias `reviewer_001` so the existing alias mapping resolves to backend `user-002`.

## Verification Workflow

1. Run `python3 scripts/review_demo_seed_test.py` to verify the plan shape and deterministic inventory output.
2. Run `python3 scripts/review_demo_seed.py --pretty` once the backend on `3100` is reachable.
3. Re-run the same seed command and compare the emitted `execution.seeded` inventory. The scenario keys, task IDs, and form IDs should remain unchanged.
4. Use the discoverability queries above or the reviewer/designer UI to confirm the seeded scenarios are visible.

## Current Environment Note

If the shared backend on `3100` is unavailable, the plan-only command still provides the expected demo inventory, but live seeding remains blocked until the backend is restarted.
