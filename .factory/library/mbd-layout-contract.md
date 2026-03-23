# MBD Layout Contract Notes

## Current Frontend Contract

`MbdLayoutHint` currently supports these established fields:
- `anchor_point`
- `primary_axis`
- `offset_dir`
- `char_dir`
- `label_role`
- `avoid_line_of_sight`
- `owner_segment_id`
- `offset_level`
- `suppress_reason`

The current type also accepts unknown keys, which makes backward-compatible optional extensions possible on the frontend side.

## Compatibility Rules

- Missing `layout_hint` must remain valid.
- Missing or invalid vector fields must degrade field-by-field rather than invalidate the whole hint.
- Missing or invalid `offset_level` must normalize to the baseline lane.
- Top-level anchor fields already present on DTOs keep precedence over hint anchors unless the implementation explicitly changes that rule.
- Manual session overrides remain outside the backend hint contract and must outrank automatic placement.

## Future Optional Fields

The mission may add frontend support for optional fields such as:
- `layout_group_id`
- `placement_lane`
- `side_locked`
- `declutter_priority`

Rules for these fields:
- their absence must preserve existing behavior
- their presence must not silently bypass manual override precedence
- they should only change behavior through explicit layout-engine logic, not through accidental object spreading or ad hoc truthiness checks

## Contract Boundary Reminder

This mission is frontend-first. Type-level readiness for optional fields is in scope; requiring a backend producer rollout is not.
