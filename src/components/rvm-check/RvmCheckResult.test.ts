/** 结果区的分组展示：横幅计数、原因分「要查 / 非几何」、不可定位行不给按钮、e3d.log 读取状态。 */
import { describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';

import RvmCheckResult from './RvmCheckResult.vue';

import type { RvmCheckReport, RvmMismatch } from '@/api/rvmCheckApi';

const loadE3dLog = vi.fn();
const recheck = vi.fn(async () => true);
const queue = ref<{ refno: string; state: string }[]>([]);

vi.mock('@/composables/useRvmCheckStore', () => ({
  useRvmCheckStore: () => ({ loadE3dLog, recheck, queue }),
}));
vi.mock('@/composables/useIncrementalRvmCheck', async () => {
  const { computed } = await import('vue');
  return { useRvmNodeBadge: () => computed(() => ({ verdict: null, outdated: false, title: '', status: null, root: null, empty: true })) };
});
vi.mock('./useRvmMismatchLocate', () => ({
  useRvmMismatchLocate: () => ({ resolved: {}, locateRow: vi.fn(), showProblems: vi.fn(), clear: vi.fn() }),
}));
vi.mock('@/api/rvmCheckApi', () => ({ RVM_CHECK_E3D_LOG: 'e3d.log', downloadRvmCheckFile: vi.fn() }));

function mismatch(category: string, name: string, extra: Partial<RvmMismatch> = {}): RvmMismatch {
  return { category, name, noun: '', max_axis_delta_mm: null, baseline_kinds: [], generated_kinds: [], baseline_aabb: null, generated_aabb: null, ...extra };
}

const ZERO = {
  both: 0, exact: 0, chord: 0, reference_artifact: 0, film: 0, off: 0, only_baseline: 0, only_generated: 0, kind_match: 0,
  kind_differ: 0, container_off: 0, container_only_baseline: 0, container_only_generated: 0, centreline_only_baseline: 0,
  unkeyable_baseline: 0, unkeyable_generated: 0,
};

function report(overrides: Partial<RvmCheckReport> = {}): RvmCheckReport {
  return {
    verdict: 'fail', message: '不一致', stage: 'compare', refno: '23705/289', name: '/OGLFL', noun: 'SITE', dbnum: 7997,
    db_type: 'DESI', sesno: 12, db_file: null, e3d_export_by: 'refno',
    counts: { ...ZERO, both: 66, off: 1, only_baseline: 1, only_generated: 1 },
    mismatches: [
      mismatch('off', 'SCTN 2 of FRMW 1 of /OGLFL1', {
        noun: 'SCTN', max_axis_delta_mm: 105, baseline_kinds: ['CYLI'], generated_kinds: ['CYLI'],
        baseline_aabb: [-11, -50, 105, 11, 50, 300], generated_aabb: [-11, -50, 0, 11, 50, 300],
      }),
      mismatch('only_baseline', 'FLOOR 1 of FRMWORK 1 of SITE 2 of WORLD /*'),
      mismatch('only_generated', '/GENERATED/FLOOR 1 of FRMW 1 of SITE 1 of WORL /*   FLOOR FLOO 1'),
    ],
    mismatches_truncated: false,
    centreline_only_baseline: [],
    timings_ms: { resolve: 0, generate_ours: 0, e3d_export: 0, compare: 0 },
    files: ['e3d.log', 'compare.json'],
    warnings: [],
    ...overrides,
  };
}

async function mount(logResult: Promise<unknown>, value: RvmCheckReport = report()) {
  loadE3dLog.mockReturnValue(logResult);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp({ render: () => h(RvmCheckResult, { taskId: 'rvm-check-1', report: value, locatable: true }) });
  app.mount(host);
  await nextTick();
  return { host, unmount: () => { app.unmount(); host.remove(); } };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('RvmCheckResult', () => {
  it('splits reasons into ours and non-geometry groups and summarises the banner', async () => {
    const { host, unmount } = await mount(new Promise(() => {}));
    try {
      const banner = host.querySelector('[data-testid="rvm-check-banner"]')!.textContent!;
      expect(banner).toContain('1 行要查我们这边，2 行不是几何问题');
      const counts = [...host.querySelectorAll('[data-testid="rvm-check-banner-counts"] > div')].map((el) => el.textContent!.replace(/\s+/g, ''));
      expect(counts).toEqual(['66配上', '1偏差', '1仅E3D', '1仅生成']);
      expect(host.querySelector('[data-testid="rvm-check-main-reasons"]')!.textContent).toBe('主要原因：长度不同 1');
      expect(host.querySelector('[data-testid="rvm-check-tool-error"]')).toBeNull();
      const chips = [...host.querySelectorAll('[data-testid="rvm-check-reason-chip"]')].map((el) => el.getAttribute('data-reason'));
      expect(chips).toEqual(['length', 'naming']);
      expect(host.querySelector('[data-testid="rvm-check-show-problems"]')!.textContent).toContain('在 3D 中查看 1 行');
      expect(host.querySelector('[data-testid="rvm-check-log-state"]')!.textContent).toContain('正在读 e3d.log');
    } finally {
      unmount();
    }
  });

  it('gives no locate button to names that cannot be found, and trims the pairing key', async () => {
    const { host, unmount } = await mount(Promise.resolve(null));
    try {
      expect(host.querySelectorAll('[data-testid="rvm-check-locate-row"]').length).toBe(1);
      const text = host.querySelector('tbody')!.textContent!;
      expect(text).toContain('/GENERATED/FLOOR 1 of FRMW 1 of SITE 1 of WORL /*');
      expect(text).not.toContain('FLOOR FLOO 1');
      await flush();
      await nextTick();
      expect(host.querySelector('[data-testid="rvm-check-log-state"]')!.textContent).toContain('没读到 e3d.log');
    } finally {
      unmount();
    }
  });

  it('shows the raw error and the files to inspect when the compare tool broke', async () => {
    const broken = report({
      message: 'rvm_compare 退出码 101：thread main panicked',
      counts: { ...ZERO },
      mismatches: [],
      files: ['e3d.log', 'compare.log', 'ours.rvm'],
    });
    const { host, unmount } = await mount(Promise.resolve(null), broken);
    try {
      const raw = host.querySelector('[data-testid="rvm-check-tool-error"]')!.textContent!;
      expect(raw).toContain('compare');
      expect(raw).toContain('rvm_compare 退出码 101');
      const files = [...host.querySelectorAll('[data-testid="rvm-check-tool-error-file"]')].map((el) => el.textContent!.trim());
      expect(files).toEqual(['compare.log']);
      expect(host.querySelector('[data-testid="rvm-check-banner-counts"]')).toBeNull();
    } finally {
      unmount();
    }
  });

  it('filters by a reason chip and expands a row into primitives and boxes', async () => {
    const { host, unmount } = await mount(Promise.resolve({ errorNames: new Set(), catalogueErrors: 0, invalidItems: 0 }));
    try {
      await flush();
      expect(host.querySelector('[data-testid="rvm-check-log-state"]')).toBeNull();
      (host.querySelector('[data-reason="naming"]') as HTMLButtonElement).click();
      await nextTick();
      expect(host.querySelectorAll('[data-testid="rvm-check-row"]').length).toBe(2);
      (host.querySelector('[data-reason="naming"]') as HTMLButtonElement).click();
      await nextTick();
      const first = host.querySelector('[data-testid="rvm-check-row"]') as HTMLElement;
      first.click();
      await nextTick();
      const detail = host.querySelector('[data-testid="rvm-check-row-detail"]')!.textContent!;
      expect(detail).toContain('E3D CYLI · 生成 CYLI');
      expect(detail).toContain('-11.0,-50.0,105.0 → 11.0,50.0,300.0');
    } finally {
      unmount();
    }
  });
});
