---
name: scrutiny-feature-reviewer
description: Review completed M4 reviewer-workbench features for blocking defects, regression risks, and missing verification before user-surface synthesis.
---

# scrutiny-feature-reviewer

Use this skill after M4 implementation features are complete.

## Scope
- Review `src/components/review/ReviewPanel.vue`, `ReviewAuxData.vue`, `ReviewDataSync.vue`
- Review related store/API files touched by the milestone
- Run mission-scoped static validation only
- Produce findings-first output with file references and exact blockers

## Procedure
1. Read mission `AGENTS.md`, `validation-contract.md`, and `features.json`.
2. Read `/Volumes/DPC/work/plant-code/plant3d-web/.factory/library/m4-review-workbench.md`.
3. Inspect the completed M4 implementation files and relevant tests.
4. Run:
   - `npm run type-check`
   - targeted `npx eslint <files>`
   - mission-scoped vitest files from `.factory/services.yaml`
5. Prioritize findings about:
   - core-zone visibility for the five M4 workbench sections
   - hidden fallback semantics around `formId/project_id/requester_id`
   - accidental M5/M6 dependency leaks into the M4 core path
6. Return findings first, with concise remediation guidance and exact file references.
