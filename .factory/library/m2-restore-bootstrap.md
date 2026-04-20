# M2 Restore Bootstrap Knowledge

- Canonical tracked M2 bootstrap doc: `docs/verification/m2-restore-bootstrap.md`
- Seed entrypoint remains `debug_scripts/review_demo_seed.py`; validators should use the M2-specific identifiers in `discoverability.m2Restore`.
- M2 reviewer confirmed restore fixture:
  - task `seed-m2-reviewer-confirmed`
  - form `FORM-M2-RESTORE-001`
- M2 empty-task clearing fixture:
  - task `seed-m2-empty-after-confirmed`
  - form `FORM-M2-RESTORE-EMPTY-001`
- M2 embed restore fixture:
  - task `seed-m2-embed-restore`
  - form `FORM-M2-EMBED-001`
  - route hint `/?user_token=<token>&workflow_role=jd&workflow_mode=external&form_id=FORM-M2-EMBED-001`
