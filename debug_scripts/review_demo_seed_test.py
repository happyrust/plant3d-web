import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'debug_scripts' / 'review_demo_seed.py'


def run_seed_command(*args: str) -> dict:
    completed = subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(completed.stdout)


def test_seed_script_creates_required_inventory_shape() -> None:
    payload = run_seed_command('--print-plan')

    assert payload['seedKey'] == 'review-demo-pack-v2'
    assert payload['scenarios']
    assert payload['trackedAssetPaths'] == {
        'seedScript': 'debug_scripts/review_demo_seed.py',
        'seedTest': 'debug_scripts/review_demo_seed_test.py',
        'seedDoc': 'docs/verification/m6-m7-demo-seed-pack.md',
        'm2BootstrapDoc': 'docs/verification/m2-restore-bootstrap.md',
    }
    assert {scenario['key'] for scenario in payload['scenarios']} == {
        'm2-reviewer-confirmed-restore',
        'm2-empty-task-clear',
        'm2-embed-form-restore',
        'text-annotation',
        'cloud-annotation',
        'rectangle-annotation',
        'measurement-replay',
        'task-thread-collaboration',
        'annotation-thread-collaboration',
        'return-resubmit-reopen',
        'qa-t6-task-only-components',
        'qa-t6-no-persisted-components',
    }
    assert payload['roles']['reviewer']['frontendUserId'] == 'reviewer_001'
    assert payload['roles']['reviewer']['backendUserId'] == 'user-002'
    assert payload['discoverability']['reviewerTaskQuery'].endswith('checker_id=user-002')
    assert payload['discoverability']['m2Restore'] == {
        'reviewerConfirmedTaskId': 'seed-m2-reviewer-confirmed',
        'emptyTaskId': 'seed-m2-empty-after-confirmed',
        'embedTaskId': 'seed-m2-embed-restore',
        'reviewerConfirmedFormId': 'FORM-M2-RESTORE-001',
        'emptyTaskFormId': 'FORM-M2-RESTORE-EMPTY-001',
        'embedFormId': 'FORM-M2-EMBED-001',
        'embedRouteHint': '/?user_token=<token>&workflow_role=jd&workflow_mode=external&form_id=FORM-M2-EMBED-001',
    }


def test_seed_script_marks_m2_restore_validation_scenarios() -> None:
    payload = run_seed_command('--print-plan')
    by_key = {scenario['key']: scenario for scenario in payload['scenarios']}

    assert by_key['m2-reviewer-confirmed-restore']['validationScenarios'] == [
        'reviewer-confirmed-restore',
        'embed-form-restore',
    ]
    assert by_key['m2-empty-task-clear']['validationScenarios'] == ['empty-task-clearing']
    assert by_key['m2-embed-form-restore']['validationScenarios'] == ['embed-form-restore']


def test_seed_script_plan_is_deterministic() -> None:
    first = run_seed_command('--print-plan')
    second = run_seed_command('--print-plan')

    assert first == second
