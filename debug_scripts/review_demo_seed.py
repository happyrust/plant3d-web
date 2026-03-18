#!/usr/bin/env python3
"""Deterministic M6+M7 demo seed pack generator.

The script has two modes:
- `--print-plan` produces the canonical demo pack inventory without touching the backend.
- default execution attempts to seed the local backend via the existing review APIs and
  then prints the resulting inventory plus discoverability hints.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from copy import deepcopy
from dataclasses import dataclass
from typing import Any


SEED_KEY = 'm6-m7-review-demo-pack-v1'
DEFAULT_BASE_URL = 'http://127.0.0.1:3100'
DEFAULT_PROJECT_ID = 'debug-project'
ATTACHMENT_SOURCE = 'debug_scripts/review_demo_seed.py'


ROLES: dict[str, dict[str, str]] = {
    'designer': {
        'frontendUserId': 'designer_001',
        'backendUserId': 'designer_001',
        'role': 'sj',
        'displayName': '王设计师',
    },
    'reviewer': {
        'frontendUserId': 'reviewer_001',
        'backendUserId': 'user-002',
        'role': 'sh',
        'displayName': '李审核员',
    },
    'approver': {
        'frontendUserId': 'manager_001',
        'backendUserId': 'manager_001',
        'role': 'pz',
        'displayName': '陈经理',
    },
}


def build_workflow_history() -> list[dict[str, Any]]:
    return [
        {
            'node': 'sj',
            'action': 'submit',
            'operatorId': ROLES['designer']['backendUserId'],
            'operatorName': ROLES['designer']['displayName'],
            'comment': 'Seeded handoff for M6/M7 validation',
            'timestamp': 1763539200000,
        },
    ]


SCENARIOS: list[dict[str, Any]] = [
    {
        'key': 'text-annotation',
        'taskId': 'seed-m6-text-annotation',
        'formId': 'FORM-M6-TEXT-001',
        'title': 'M6 Seed / Text Annotation Review',
        'description': 'Canonical text annotation path for seeded reviewer validation.',
        'modelName': 'M6 Demo / Annotation',
        'status': 'submitted',
        'priority': 'high',
        'currentNode': 'jd',
        'components': [
            {'id': 'cmp-text-001', 'refNo': 'PIPE-TEXT-001', 'name': 'Text Anchor Spool', 'type': 'Pipe'},
        ],
        'attachments': [
            {
                'id': 'seed-att-text',
                'name': 'm6-text-annotation-seed.md',
                'url': f'/{ATTACHMENT_SOURCE}',
                'type': 'seed-note',
                'mimeType': 'text/markdown',
                'uploadedAt': 1763539200000,
            },
        ],
        'confirmedRecord': {
            'id': 'seed-record-text',
            'taskId': 'seed-m6-text-annotation',
            'type': 'batch',
            'annotations': [
                {
                    'id': 'seed-text-annotation-1',
                    'entityId': 'PIPE-TEXT-001',
                    'worldPos': [12.0, 4.2, 1.0],
                    'visible': True,
                    'glyph': 'A1',
                    'title': 'Check nozzle clearance label',
                    'description': 'Canonical text annotation seeded for reviewer direct-launch replay.',
                    'createdAt': 1763539201000,
                },
            ],
            'cloudAnnotations': [],
            'rectAnnotations': [],
            'obbAnnotations': [],
            'measurements': [],
            'note': 'Seeded canonical text annotation confirmation',
            'confirmedAt': 1763539202000,
        },
        'comments': [],
        'tags': ['text', 'canonical-annotation'],
    },
    {
        'key': 'cloud-annotation',
        'taskId': 'seed-m6-cloud-annotation',
        'formId': 'FORM-M6-CLOUD-001',
        'title': 'M6 Seed / Cloud Annotation Review',
        'description': 'Canonical cloud annotation path for seeded reviewer validation.',
        'modelName': 'M6 Demo / Annotation',
        'status': 'submitted',
        'priority': 'high',
        'currentNode': 'jd',
        'components': [
            {'id': 'cmp-cloud-001', 'refNo': 'PIPE-CLOUD-001', 'name': 'Cloud Mark Area', 'type': 'Pipe'},
        ],
        'attachments': [],
        'confirmedRecord': {
            'id': 'seed-record-cloud',
            'taskId': 'seed-m6-cloud-annotation',
            'type': 'batch',
            'annotations': [],
            'cloudAnnotations': [
                {
                    'id': 'seed-cloud-annotation-1',
                    'anchorWorldPos': [22.4, 6.0, 3.0],
                    'screenSpacePoints': [[120, 140], [200, 180], [240, 160]],
                    'visible': True,
                    'title': 'Inspect branch support interference',
                    'description': 'Seeded cloud annotation to validate canonical reviewer semantics.',
                    'createdAt': 1763539203000,
                },
            ],
            'rectAnnotations': [],
            'obbAnnotations': [],
            'measurements': [],
            'note': 'Seeded canonical cloud annotation confirmation',
            'confirmedAt': 1763539204000,
        },
        'comments': [],
        'tags': ['cloud', 'canonical-annotation'],
    },
    {
        'key': 'rectangle-annotation',
        'taskId': 'seed-m6-rectangle-annotation',
        'formId': 'FORM-M6-RECT-001',
        'title': 'M6 Seed / Rectangle Annotation Review',
        'description': 'Canonical rectangle annotation path replacing legacy reviewer-visible OBB terms.',
        'modelName': 'M6 Demo / Annotation',
        'status': 'submitted',
        'priority': 'high',
        'currentNode': 'jd',
        'components': [
            {'id': 'cmp-rect-001', 'refNo': 'PIPE-RECT-001', 'name': 'Rectangle Review Zone', 'type': 'Pipe'},
        ],
        'attachments': [],
        'confirmedRecord': {
            'id': 'seed-record-rect',
            'taskId': 'seed-m6-rectangle-annotation',
            'type': 'batch',
            'annotations': [],
            'cloudAnnotations': [],
            'rectAnnotations': [
                {
                    'id': 'seed-rectangle-annotation-1',
                    'anchorWorldPos': [18.0, 8.0, 2.5],
                    'visible': True,
                    'title': 'Rectangle focus for canonical reviewer flow',
                    'description': 'Seeded rectangle annotation replacing legacy OBB naming.',
                    'createdAt': 1763539205000,
                    'obb': {
                        'center': [18.0, 8.0, 2.5],
                        'axes': [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
                        'halfSize': [1.2, 0.6, 0.4],
                        'corners': [
                            [16.8, 7.4, 2.1],
                            [19.2, 7.4, 2.1],
                            [16.8, 8.6, 2.1],
                            [19.2, 8.6, 2.1],
                            [16.8, 7.4, 2.9],
                            [19.2, 7.4, 2.9],
                            [16.8, 8.6, 2.9],
                            [19.2, 8.6, 2.9],
                        ],
                    },
                },
            ],
            'obbAnnotations': [],
            'measurements': [],
            'note': 'Seeded canonical rectangle annotation confirmation',
            'confirmedAt': 1763539206000,
        },
        'comments': [],
        'tags': ['rectangle', 'canonical-annotation'],
    },
    {
        'key': 'measurement-replay',
        'taskId': 'seed-m6-measurement-replay',
        'formId': 'FORM-M6-MEASURE-001',
        'title': 'M6 Seed / Measurement Replay Review',
        'description': 'Confirmed measurement replay path shared between reviewer and designer surfaces.',
        'modelName': 'M6 Demo / Measurement',
        'status': 'submitted',
        'priority': 'urgent',
        'currentNode': 'jd',
        'components': [
            {'id': 'cmp-measure-001', 'refNo': 'PIPE-MEASURE-001', 'name': 'Measurement Span', 'type': 'Pipe'},
        ],
        'attachments': [],
        'confirmedRecord': {
            'id': 'seed-record-measure',
            'taskId': 'seed-m6-measurement-replay',
            'type': 'batch',
            'annotations': [],
            'cloudAnnotations': [],
            'rectAnnotations': [],
            'obbAnnotations': [],
            'measurements': [
                {
                    'id': 'seed-measurement-1',
                    'kind': 'distance',
                    'label': 'North rack clearance',
                    'value': 4.275,
                    'unit': 'm',
                    'start': [0.0, 0.0, 0.0],
                    'end': [4.275, 0.0, 0.0],
                    'createdAt': 1763539207000,
                },
            ],
            'note': 'Seeded confirmed measurement replay batch',
            'confirmedAt': 1763539208000,
        },
        'comments': [],
        'tags': ['measurement', 'replay'],
    },
    {
        'key': 'task-thread-collaboration',
        'taskId': 'seed-m7-task-thread',
        'formId': 'FORM-M7-TASK-THREAD-001',
        'title': 'M7 Seed / Task Thread Collaboration',
        'description': 'Whole-task collaboration scenario for reviewer/designer continuity.',
        'modelName': 'M7 Demo / Collaboration',
        'status': 'submitted',
        'priority': 'high',
        'currentNode': 'jd',
        'components': [
            {'id': 'cmp-thread-001', 'refNo': 'THREAD-TASK-001', 'name': 'Task Thread Fixture', 'type': 'Pipe'},
        ],
        'attachments': [
            {
                'id': 'seed-att-thread',
                'name': 'task-thread-context.txt',
                'url': f'/{ATTACHMENT_SOURCE}',
                'type': 'comment-attachment',
                'mimeType': 'text/plain',
                'uploadedAt': 1763539209000,
            },
        ],
        'confirmedRecord': None,
        'comments': [
            {
                'id': 'seed-task-thread-root',
                'annotationId': 'seed-m7-task-thread:task',
                'annotationType': 'text',
                'authorId': ROLES['reviewer']['backendUserId'],
                'authorName': ROLES['reviewer']['displayName'],
                'authorRole': 'reviewer',
                'content': '@designer_001 Please verify the whole task thread fixture is ready for resubmit.',
                'createdAt': 1763539210000,
                'updatedAt': 1763539211000,
            },
            {
                'id': 'seed-task-thread-reply',
                'annotationId': 'seed-m7-task-thread:task',
                'annotationType': 'text',
                'authorId': ROLES['designer']['backendUserId'],
                'authorName': ROLES['designer']['displayName'],
                'authorRole': 'designer',
                'content': 'Designer reply seeded for task-thread continuity.',
                'replyToId': 'seed-task-thread-root',
                'createdAt': 1763539212000,
                'updatedAt': 1763539213000,
            },
        ],
        'tags': ['task-thread', 'collaboration'],
    },
    {
        'key': 'annotation-thread-collaboration',
        'taskId': 'seed-m7-annotation-thread',
        'formId': 'FORM-M7-ANNOTATION-THREAD-001',
        'title': 'M7 Seed / Annotation Thread Collaboration',
        'description': 'Per-annotation collaboration scenario anchored to canonical text annotation identity.',
        'modelName': 'M7 Demo / Collaboration',
        'status': 'submitted',
        'priority': 'high',
        'currentNode': 'jd',
        'components': [
            {'id': 'cmp-thread-anno-001', 'refNo': 'THREAD-ANNOTATION-001', 'name': 'Annotation Thread Fixture', 'type': 'Pipe'},
        ],
        'attachments': [],
        'confirmedRecord': {
            'id': 'seed-record-annotation-thread',
            'taskId': 'seed-m7-annotation-thread',
            'type': 'batch',
            'annotations': [
                {
                    'id': 'seed-annotation-thread-anchor',
                    'entityId': 'THREAD-ANNOTATION-001',
                    'worldPos': [30.0, 12.0, 2.0],
                    'visible': True,
                    'glyph': 'B2',
                    'title': 'Thread anchor annotation',
                    'description': 'Canonical anchor used for annotation-thread collaboration seeding.',
                    'createdAt': 1763539214000,
                },
            ],
            'cloudAnnotations': [],
            'rectAnnotations': [],
            'obbAnnotations': [],
            'measurements': [],
            'note': 'Seeded annotation-thread anchor',
            'confirmedAt': 1763539215000,
        },
        'comments': [
            {
                'id': 'seed-annotation-thread-root',
                'annotationId': 'seed-annotation-thread-anchor',
                'annotationType': 'text',
                'authorId': ROLES['reviewer']['backendUserId'],
                'authorName': ROLES['reviewer']['displayName'],
                'authorRole': 'reviewer',
                'content': 'Seeded reviewer annotation-thread comment with explicit lineage.',
                'createdAt': 1763539216000,
                'updatedAt': 1763539217000,
            },
            {
                'id': 'seed-annotation-thread-reply',
                'annotationId': 'seed-annotation-thread-anchor',
                'annotationType': 'text',
                'authorId': ROLES['designer']['backendUserId'],
                'authorName': ROLES['designer']['displayName'],
                'authorRole': 'designer',
                'content': 'Seeded designer reply for annotation-thread continuity.',
                'replyToId': 'seed-annotation-thread-root',
                'createdAt': 1763539218000,
                'updatedAt': 1763539219000,
            },
        ],
        'tags': ['annotation-thread', 'collaboration'],
    },
    {
        'key': 'return-resubmit-reopen',
        'taskId': 'seed-m6m7-return-resubmit',
        'formId': 'FORM-M6M7-LOOP-001',
        'title': 'M6+M7 Seed / Return Resubmit Reopen Loop',
        'description': 'Closed-loop reviewer -> designer -> reviewer fixture preserving records and thread lineage.',
        'modelName': 'M6M7 Demo / Closed Loop',
        'status': 'submitted',
        'priority': 'urgent',
        'currentNode': 'jd',
        'components': [
            {'id': 'cmp-loop-001', 'refNo': 'LOOP-001', 'name': 'Loop Fixture Primary', 'type': 'Pipe'},
            {'id': 'cmp-loop-002', 'refNo': 'LOOP-002', 'name': 'Loop Fixture Secondary', 'type': 'Support'},
        ],
        'attachments': [],
        'confirmedRecord': {
            'id': 'seed-record-loop',
            'taskId': 'seed-m6m7-return-resubmit',
            'type': 'batch',
            'annotations': [
                {
                    'id': 'seed-loop-annotation',
                    'entityId': 'LOOP-001',
                    'worldPos': [40.0, 16.0, 2.0],
                    'visible': True,
                    'glyph': 'L1',
                    'title': 'Loop lineage anchor',
                    'description': 'Seeded annotation that should survive return/resubmit/reopen.',
                    'createdAt': 1763539220000,
                },
            ],
            'cloudAnnotations': [],
            'rectAnnotations': [],
            'obbAnnotations': [],
            'measurements': [
                {
                    'id': 'seed-loop-measurement',
                    'kind': 'distance',
                    'label': 'Return loop clearance',
                    'value': 2.118,
                    'unit': 'm',
                    'start': [1.0, 1.0, 0.0],
                    'end': [3.118, 1.0, 0.0],
                    'createdAt': 1763539221000,
                },
            ],
            'note': 'Seeded return/resubmit/reopen replay pack',
            'confirmedAt': 1763539222000,
        },
        'comments': [
            {
                'id': 'seed-loop-task-thread',
                'annotationId': 'seed-m6m7-return-resubmit:task',
                'annotationType': 'text',
                'authorId': ROLES['reviewer']['backendUserId'],
                'authorName': ROLES['reviewer']['displayName'],
                'authorRole': 'reviewer',
                'content': 'Seeded task-thread root for the return/resubmit loop.',
                'createdAt': 1763539223000,
                'updatedAt': 1763539224000,
            },
        ],
        'tags': ['closed-loop', 'return-resubmit-reopen'],
        'workflowHistory': [
            {
                'node': 'sj',
                'action': 'submit',
                'operatorId': ROLES['designer']['backendUserId'],
                'operatorName': ROLES['designer']['displayName'],
                'comment': 'Initial seeded submit',
                'timestamp': 1763539225000,
            },
            {
                'node': 'jd',
                'action': 'return',
                'operatorId': ROLES['reviewer']['backendUserId'],
                'operatorName': ROLES['reviewer']['displayName'],
                'comment': 'Seeded reviewer return for loop continuity.',
                'timestamp': 1763539226000,
            },
            {
                'node': 'sj',
                'action': 'submit',
                'operatorId': ROLES['designer']['backendUserId'],
                'operatorName': ROLES['designer']['displayName'],
                'comment': 'Seeded designer resubmit for loop continuity.',
                'timestamp': 1763539227000,
            },
        ],
    },
]


def clone_task_payload(scenario: dict[str, Any]) -> dict[str, Any]:
    payload = {
        'id': scenario['taskId'],
        'formId': scenario['formId'],
        'title': scenario['title'],
        'description': scenario['description'],
        'modelName': scenario['modelName'],
        'status': scenario['status'],
        'priority': scenario['priority'],
        'requesterId': ROLES['designer']['backendUserId'],
        'requesterName': ROLES['designer']['displayName'],
        'checkerId': ROLES['reviewer']['backendUserId'],
        'checkerName': ROLES['reviewer']['displayName'],
        'approverId': ROLES['approver']['backendUserId'],
        'approverName': ROLES['approver']['displayName'],
        'reviewerId': ROLES['reviewer']['backendUserId'],
        'reviewerName': ROLES['reviewer']['displayName'],
        'components': deepcopy(scenario['components']),
        'attachments': deepcopy(scenario['attachments']),
        'createdAt': 1763539200000,
        'updatedAt': 1763539200000,
        'currentNode': scenario['currentNode'],
        'workflowHistory': deepcopy(scenario.get('workflowHistory') or build_workflow_history()),
    }
    return payload


def expected_task_ids() -> set[str]:
    return {scenario['taskId'] for scenario in SCENARIOS}


def build_plan(base_url: str) -> dict[str, Any]:
    return {
        'seedKey': SEED_KEY,
        'projectId': DEFAULT_PROJECT_ID,
        'baseUrl': base_url.rstrip('/'),
        'roles': deepcopy(ROLES),
        'trackedAssetPaths': {
            'seedScript': 'debug_scripts/review_demo_seed.py',
            'seedTest': 'debug_scripts/review_demo_seed_test.py',
            'seedDoc': 'docs/verification/m6-m7-demo-seed-pack.md',
        },
        'scenarios': [
            {
                'key': scenario['key'],
                'taskId': scenario['taskId'],
                'formId': scenario['formId'],
                'title': scenario['title'],
                'currentNode': scenario['currentNode'],
                'status': scenario['status'],
                'tags': deepcopy(scenario['tags']),
                'discoverability': {
                    'reviewerInbox': True,
                    'designerRequesterId': ROLES['designer']['backendUserId'],
                    'reviewerCheckerId': ROLES['reviewer']['backendUserId'],
                },
                'seededPayload': {
                    'task': clone_task_payload(scenario),
                    'confirmedRecord': deepcopy(scenario['confirmedRecord']),
                    'comments': deepcopy(scenario['comments']),
                },
            }
            for scenario in SCENARIOS
        ],
        'discoverability': {
            'reviewerTaskQuery': f"{base_url.rstrip('/')}/api/review/tasks?checker_id={urllib.parse.quote(ROLES['reviewer']['backendUserId'])}",
            'designerTaskQuery': f"{base_url.rstrip('/')}/api/review/tasks?requester_id={urllib.parse.quote(ROLES['designer']['backendUserId'])}",
            'approverTaskQuery': f"{base_url.rstrip('/')}/api/review/tasks?approver_id={urllib.parse.quote(ROLES['approver']['backendUserId'])}",
            'frontendReviewerAlias': ROLES['reviewer']['frontendUserId'],
            'frontendDesignerAlias': ROLES['designer']['frontendUserId'],
        },
    }


class BackendClient:
    def __init__(self, base_url: str, timeout: float) -> None:
        self.base_url = base_url.rstrip('/')
        self.timeout = timeout

    def request_json(self, method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        body = None
        headers = {'Content-Type': 'application/json'}
        if payload is not None:
            body = json.dumps(payload).encode('utf-8')
        request = urllib.request.Request(f'{self.base_url}{path}', data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                content = response.read().decode('utf-8')
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode('utf-8', 'replace')
            raise RuntimeError(f'{method} {path} failed with HTTP {exc.code}: {detail}') from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f'{method} {path} failed: {exc.reason}') from exc
        return json.loads(content) if content else {}

    def healthcheck(self) -> dict[str, Any]:
        return self.request_json('GET', '/api/health')

    def review_task_list(self, query_name: str, query_value: str) -> dict[str, Any]:
        qs = urllib.parse.urlencode({query_name: query_value})
        return self.request_json('GET', f'/api/review/tasks?{qs}')


@dataclass
class SeedResult:
    task_id: str
    form_id: str
    title: str
    scenario_key: str
    created: bool
    synced_record: bool
    synced_comments: int


def sync_task_inventory(client: BackendClient) -> tuple[list[SeedResult], list[str]]:
    warnings: list[str] = []
    results: list[SeedResult] = []

    for scenario in SCENARIOS:
        task_payload = {'tasks': [clone_task_payload(scenario)], 'overwrite': True}
        response = client.request_json('POST', '/api/review/sync/import', task_payload)
        if not response.get('success', False):
            raise RuntimeError(response.get('error_message') or f"Failed to import task {scenario['taskId']}")

        record_synced = False
        if scenario['confirmedRecord'] is not None:
            record_response = client.request_json('POST', '/api/review/records', deepcopy(scenario['confirmedRecord']))
            if not record_response.get('success', False):
                warnings.append(
                    f"Confirmed record for {scenario['taskId']} was not stored: {record_response.get('error_message', 'unknown error')}"
                )
            else:
                record_synced = True

        comment_count = 0
        for comment in scenario['comments']:
            comment_payload = deepcopy(comment)
            comment_payload.pop('id', None)
            comment_payload.pop('updatedAt', None)
            response_comment = client.request_json('POST', '/api/review/comments', comment_payload)
            if response_comment.get('success', False):
                comment_count += 1
            else:
                warnings.append(
                    f"Comment for {scenario['taskId']} was not stored: {response_comment.get('error_message', 'unknown error')}"
                )

        results.append(
            SeedResult(
                task_id=scenario['taskId'],
                form_id=scenario['formId'],
                title=scenario['title'],
                scenario_key=scenario['key'],
                created=bool(response.get('importedCount', 0)),
                synced_record=record_synced,
                synced_comments=comment_count,
            )
        )

    return results, warnings


def normalize_task_rows(response: dict[str, Any]) -> list[dict[str, Any]]:
    rows = response.get('tasks')
    if isinstance(rows, list):
        return [row for row in rows if isinstance(row, dict)]
    data = response.get('data')
    if isinstance(data, list):
        return [row for row in data if isinstance(row, dict)]
    return []


def summarize_discoverability(response: dict[str, Any], query_name: str, query_value: str) -> dict[str, Any]:
    tasks = normalize_task_rows(response)
    task_ids = sorted({str(task.get('id') or task.get('taskId') or '') for task in tasks if task.get('id') or task.get('taskId')})
    seeded_ids = sorted(task_id for task_id in task_ids if task_id in expected_task_ids())
    total = response.get('total')
    if not isinstance(total, int):
        total = len(tasks)
    return {
        'query': {'name': query_name, 'value': query_value},
        'total': total,
        'returnedTaskIds': task_ids,
        'seededTaskIds': seeded_ids,
        'missingSeededTaskIds': sorted(expected_task_ids() - set(seeded_ids)),
        'extraTaskIds': sorted(set(task_ids) - expected_task_ids()),
    }


def collect_discoverability(client: BackendClient) -> dict[str, Any]:
    reviewer = summarize_discoverability(
        client.review_task_list('checker_id', ROLES['reviewer']['backendUserId']),
        'checker_id',
        ROLES['reviewer']['backendUserId'],
    )
    designer = summarize_discoverability(
        client.review_task_list('requester_id', ROLES['designer']['backendUserId']),
        'requester_id',
        ROLES['designer']['backendUserId'],
    )
    approver = summarize_discoverability(
        client.review_task_list('approver_id', ROLES['approver']['backendUserId']),
        'approver_id',
        ROLES['approver']['backendUserId'],
    )
    consistency = {
        'reviewerVsDesignerSeededIdsMatch': reviewer['seededTaskIds'] == designer['seededTaskIds'],
        'reviewerVsDesignerSeededCountMatch': len(reviewer['seededTaskIds']) == len(designer['seededTaskIds']),
        'approverSeesSameSeededIds': approver['seededTaskIds'] == reviewer['seededTaskIds'],
    }
    return {
        'reviewer': reviewer,
        'designer': designer,
        'approver': approver,
        'consistency': consistency,
    }


def build_runtime_output(base_url: str, results: list[SeedResult], warnings: list[str], discoverability: dict[str, Any]) -> dict[str, Any]:
    payload = build_plan(base_url)
    payload['execution'] = {
        'seeded': [
            {
                'scenarioKey': result.scenario_key,
                'taskId': result.task_id,
                'formId': result.form_id,
                'title': result.title,
                'createdOrUpdated': result.created,
                'confirmedRecordSynced': result.synced_record,
                'commentsSynced': result.synced_comments,
            }
            for result in results
        ],
        'warnings': warnings,
        'discoverability': discoverability,
    }
    return payload


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Seed deterministic M6+M7 demo review data.')
    parser.add_argument('--base-url', default=DEFAULT_BASE_URL, help='Backend base URL, default: %(default)s')
    parser.add_argument('--timeout', type=float, default=5.0, help='HTTP timeout in seconds')
    parser.add_argument('--print-plan', action='store_true', help='Print the deterministic seed plan without calling the backend')
    parser.add_argument('--pretty', action='store_true', help='Pretty-print JSON output')
    return parser.parse_args(argv)


def dump_json(payload: dict[str, Any], pretty: bool) -> None:
    json.dump(payload, sys.stdout, ensure_ascii=True, indent=2 if pretty else None, sort_keys=True)
    sys.stdout.write('\n')


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    plan = build_plan(args.base_url)
    if args.print_plan:
        dump_json(plan, args.pretty)
        return 0

    client = BackendClient(args.base_url, args.timeout)
    try:
        client.healthcheck()
        results, warnings = sync_task_inventory(client)
        discoverability = collect_discoverability(client)
    except RuntimeError as exc:
        error_payload = {
            'seedKey': SEED_KEY,
            'baseUrl': args.base_url.rstrip('/'),
            'error': str(exc),
            'hint': 'Ensure the shared backend on 3100 is reachable before running the live seed command.',
        }
        dump_json(error_payload, True)
        return 1

    dump_json(build_runtime_output(args.base_url, results, warnings, discoverability), args.pretty)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
