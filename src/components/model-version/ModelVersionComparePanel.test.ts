import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';

import ModelVersionComparePanel from './ModelVersionComparePanel.vue';

const FROM_RELEASE = 'codex-ams1112-physical-791-quarantine';
const TO_RELEASE = 'codex-ams1112-physical-897-quarantine';

let fetchCalls: string[] = [];

function response(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

function defaultDiffRows() {
  return [
    {
      change_type: 'changed',
      component_key: '1112:75144748061193',
      dbnum: 1112,
      noun: 'BOX',
      refno_str: '17496_250377',
      refno_u64: 75144748061193,
    },
    {
      change_type: 'changed',
      component_key: '1112:75144748061194',
      dbnum: 1112,
      noun: 'BOX',
      refno_str: '17496_250378',
      refno_u64: 75144748061194,
    },
  ];
}

function stubFetch() {
  fetchCalls = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    fetchCalls.push(url);
    if (url.startsWith('/api/model-version/compare-readiness')) {
      return response({
        data: {
          readiness: {
            dbnum: 1112,
            classification: 'quarantined_visual',
            production_ready: false,
            from: { baseline_state_manifest_path: 'output/from-baseline.json' },
            to: { baseline_state_manifest_path: 'output/to-baseline.json' },
          },
        },
      });
    }
    if (url.startsWith('/api/model-version/diff')) {
      return response({
        success: true,
        data: {
          diff: {
            dbnum: 1112,
            from_release_id: FROM_RELEASE,
            to_release_id: TO_RELEASE,
            rows: defaultDiffRows(),
            summary: {
              added: 5059,
              changed: 43,
              deleted: 2525,
              unchanged: 23549,
              emitted: 2,
              total_old: 26117,
              total_new: 28651,
            },
          },
        },
      });
    }
    if (url.endsWith('/output/from-baseline.json')) {
      return response({
        source_db_file: 'D:\\AVEVA\\Projects\\E3D2.1\\AvevaMarineSample\\ams1112_0001 copy',
        source_db_latest_sesno: 791,
      });
    }
    if (url.endsWith('/output/to-baseline.json')) {
      return response({
        source_db_file: '\\\\?\\D:\\AVEVA\\Projects\\E3D2.1\\AvevaMarineSample\\ams000\\ams1112_0001',
        source_db_latest_sesno: 897,
      });
    }
    return response({}, false);
  }));
}

async function waitForAsyncUi() {
  for (let i = 0; i < 8; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();
  }
}

describe('ModelVersionComparePanel', () => {
  beforeEach(() => {
    stubFetch();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    window.history.replaceState({}, '', '/');
    vi.unstubAllGlobals();
  });

  it('uses the formal DTX compare control instead of embedding a backend viewer iframe', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const app = createApp(ModelVersionComparePanel, { disableFrameNavigation: true });
    app.mount(host);
    await waitForAsyncUi();

    expect(host.querySelector('iframe')).toBeNull();
    expect(host.querySelector('[data-testid="model-version-compare-dtx-summary"]')?.textContent)
      .toContain('使用主三维 DTX 视图');
    expect(host.querySelector('[data-testid="model-version-compare-dtx-summary"]')?.textContent)
      .toContain('变更 43 / 新增 5059 / 删除 2525');
    expect(host.querySelector('[data-testid="model-version-compare-diff-list"]')?.textContent)
      .toContain('17496_250377');

    const diffUrl = fetchCalls.find((url) => url.startsWith('/api/model-version/diff'));
    expect(diffUrl).toContain('project=AvevaMarineSample');
    expect(diffUrl).toContain(`from_release_id=${FROM_RELEASE}`);
    expect(diffUrl).toContain(`to_release_id=${TO_RELEASE}`);
    expect(diffUrl).toContain('change_type=changed');
    expect(diffUrl).toContain('limit=10');

    app.unmount();
  });

  it('shows diagnostic readiness and real source details', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const app = createApp(ModelVersionComparePanel, { disableFrameNavigation: true });
    app.mount(host);
    await waitForAsyncUi();

    const statusButton = host.querySelector('[data-testid="model-version-compare-data-status"]') as HTMLButtonElement | null;
    expect(statusButton?.textContent).toContain('诊断');
    expect(statusButton?.getAttribute('title')).toBe('not production_ready: quarantined_visual');

    statusButton?.click();
    await nextTick();
    await waitForAsyncUi();

    expect(host.querySelector('[data-testid="model-version-compare-provenance"]')?.textContent)
      .toContain('791=ams1112_0001 copy');
    expect(host.querySelector('[data-testid="model-version-compare-provenance"]')?.textContent)
      .toContain('897=ams000\\ams1112_0001');

    app.unmount();
  });

  it('keeps explicit release and component context in the diff request', async () => {
    window.history.replaceState({}, '', '/?output_project=AvevaMarineSample&from_release_id=from-real&to_release_id=to-real&dbnum=7997&component_key=7997%3A42&diff_limit=50');
    const host = document.createElement('div');
    document.body.appendChild(host);

    const app = createApp(ModelVersionComparePanel, { disableFrameNavigation: true });
    app.mount(host);
    await waitForAsyncUi();

    const diffUrl = fetchCalls.find((url) => url.startsWith('/api/model-version/diff'));
    expect(diffUrl).toContain('from_release_id=from-real');
    expect(diffUrl).toContain('to_release_id=to-real');
    expect(diffUrl).toContain('component_key=7997%3A42');
    expect(diffUrl).toContain('limit=50');
    expect(diffUrl).toContain('change_type=changed');

    app.unmount();
  });

  it('emits a DTX viewer compare event when navigation is enabled', async () => {
    const events: CustomEvent[] = [];
    const listener = (event: Event) => events.push(event as CustomEvent);
    window.addEventListener('plant3d:incremental-version-compare', listener);

    const host = document.createElement('div');
    document.body.appendChild(host);

    const app = createApp(ModelVersionComparePanel);
    app.mount(host);
    await waitForAsyncUi();

    expect(events.length).toBeGreaterThan(0);
    expect(events[0].detail).toEqual(expect.objectContaining({
      project: 'AvevaMarineSample',
      dbnum: 1112,
      fromReleaseId: FROM_RELEASE,
      toReleaseId: TO_RELEASE,
      fromSesno: 791,
      toSesno: 897,
      mode: 'dtx',
      compare: true,
      componentKey: '1112:75144748061193',
      refnos: ['17496_250377'],
    }));
    expect(events[0].detail.models[0]).toEqual(expect.objectContaining({
      refno: '17496_250377',
      componentKey: '1112:75144748061193',
      refnoU64: 75144748061193,
      status: 'modified',
      beforeState: 'present',
      afterState: 'present',
    }));

    window.removeEventListener('plant3d:incremental-version-compare', listener);
    app.unmount();
  });

  it('lets the user select another real diff row for DTX display', async () => {
    const events: CustomEvent[] = [];
    const listener = (event: Event) => events.push(event as CustomEvent);
    window.addEventListener('plant3d:incremental-version-compare', listener);

    const host = document.createElement('div');
    document.body.appendChild(host);

    const app = createApp(ModelVersionComparePanel);
    app.mount(host);
    await waitForAsyncUi();

    const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>('[data-testid="model-version-compare-diff-list"] button'));
    buttons[1]?.click();
    await nextTick();

    expect(events.at(-1)?.detail.refnos).toEqual(['17496_250378']);

    window.removeEventListener('plant3d:incremental-version-compare', listener);
    app.unmount();
  });
});
