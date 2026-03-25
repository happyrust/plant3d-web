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

    assert payload['seedKey'] == 'm6-m7-review-demo-pack-v1'
    assert payload['scenarios']
    assert payload['trackedAssetPaths'] == {
        'seedScript': 'debug_scripts/review_demo_seed.py',
        'seedTest': 'debug_scripts/review_demo_seed_test.py',
        'seedDoc': 'docs/verification/m6-m7-demo-seed-pack.md',
    }
    assert {scenario['key'] for scenario in payload['scenarios']} == {
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


def test_seed_script_plan_is_deterministic() -> None:
    first = run_seed_command('--print-plan')
    second = run_seed_command('--print-plan')

    assert first == second
