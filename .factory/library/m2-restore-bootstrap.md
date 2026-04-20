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
- Browser-safe helper:
  - open `http://127.0.0.1:3101/pms-review-simulator.html?output_project=AvevaMarineSample`
  - use token-primary mode / `新增` or `重开最近 form_id`
  - copy the simulator diagnostics field `最终 iframe src`
  - that URL is the supported browser-safe launch path for FORM-M2-EMBED-001 validation
