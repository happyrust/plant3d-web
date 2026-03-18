# M6 Seed Discoverability Hardening

- The maintained M6+M7 seed entry point now lives in tracked `debug_scripts/review_demo_seed.py` because repo `.gitignore` ignores `scripts/`.
- The paired executable check lives in tracked `debug_scripts/review_demo_seed_test.py`.
- `docs/verification/m6-m7-demo-seed-pack.md` is the source-of-truth doc for seeded scenario IDs, role aliases, and discoverability queries.
- Live seed output includes `execution.discoverability` so later validators can compare reviewer `checker_id=user-002` and designer `requester_id=designer_001` inventories without manual diffing.
