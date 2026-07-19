import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';

import ModelTreeAttrDiffPanel from './ModelTreeAttrDiffPanel.vue';

import {
  AnchorMissingError,
  ExpiredError,
  getSnapshot,
  resolveAnchor,
  type ModelHistoryAnchor,
  type ModelHistorySnapshot,
} from '@/api/modelVersionApi';

vi.mock('@/api/modelVersionApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/modelVersionApi')>();
  return {
    ...actual,
    resolveAnchor: vi.fn(),
    getSnapshot: vi.fn(),
  };
});

const resolveAnchorMock = vi.mocked(resolveAnchor);
const getSnapshotMock = vi.mocked(getSnapshot);

const DBNUM = 1112;
const FROM_SESNO = 896;
const TO_SESNO = 897;
const REFNO = '17496_250377';

function anchor(sesno: number, exact = true): ModelHistoryAnchor {
  return {
    dbnum: DBNUM,
    sesno,
    anchored_at: `2026-07-16T15:40:${sesno % 60}.000Z`,
    source: null,
    exact,
  };
}

/** rs-core version_query::ElementSnapshot 实测结构（pe_att_history_api.rs 透传 snapshot_at） */
function snapshot(
  sesno: number,
  pe: Record<string, unknown> | null,
  att: Record<string, unknown> | null = null,
): ModelHistorySnapshot {
  return {
    refno_u64: 75144748061193,
    pe_key: `pe:${REFNO}`,
    requested_sesno: sesno,
    resolved_sesno: sesno,
    exact_anchor: true,
    anchored_at: `2026-07-16T15:40:${sesno % 60}.000Z`,
    exists: pe !== null,
    pe,
    att,
    noun: pe ? String(pe.noun ?? '') : null,
  };
}

function defaultProps(overrides?: Record<string, unknown>) {
  return {
    model: { refno: REFNO, status: 'modified', category: 'BOX' },
    dbnum: DBNUM,
    fromSesno: FROM_SESNO,
    toSesno: TO_SESNO,
    canLocate: true,
    ...overrides,
  };
}

async function waitForAsyncUi() {
  for (let i = 0; i < 8; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();
  }
}

let apps: App[] = [];

function mountPanel(props = defaultProps()): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp(ModelTreeAttrDiffPanel, props);
  app.mount(host);
  apps.push(app);
  return host;
}

function stubHappyPath() {
  resolveAnchorMock.mockImplementation(async (_dbnum, sesno) => anchor(sesno));
  getSnapshotMock.mockImplementation(async (_dbnum, sesno) => {
    if (sesno === FROM_SESNO) {
      return snapshot(sesno, { noun: 'BOX', DESC: 'old-desc', XLEN: 100 }, { HEIG: 10 });
    }
    return snapshot(sesno, { noun: 'BOX', DESC: 'new-desc', WIDT: 50 }, { HEIG: 20 });
  });
}

describe('ModelTreeAttrDiffPanel', () => {
  beforeEach(() => {
    resolveAnchorMock.mockReset();
    getSnapshotMock.mockReset();
  });

  afterEach(() => {
    for (const app of apps) app.unmount();
    apps = [];
    document.body.innerHTML = '';
  });

  it('resolves both anchors then loads snapshot×2 with correct dbnum/sesno/refno', async () => {
    stubHappyPath();
    mountPanel();
    await waitForAsyncUi();

    expect(resolveAnchorMock).toHaveBeenCalledTimes(2);
    expect(resolveAnchorMock).toHaveBeenCalledWith(
      DBNUM, FROM_SESNO, undefined,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(resolveAnchorMock).toHaveBeenCalledWith(
      DBNUM, TO_SESNO, undefined,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    expect(getSnapshotMock).toHaveBeenCalledTimes(2);
    expect(getSnapshotMock).toHaveBeenCalledWith(
      DBNUM, FROM_SESNO, REFNO, undefined,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(getSnapshotMock).toHaveBeenCalledWith(
      DBNUM, TO_SESNO, REFNO, undefined,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('renders changed/added/removed rows from the client-side snapshot diff', async () => {
    stubHappyPath();
    const host = mountPanel();
    await waitForAsyncUi();

    const table = host.querySelector('[data-testid="attr-diff-table"]');
    expect(table).not.toBeNull();

    const rows = Array.from(table!.querySelectorAll('tbody tr')).map((tr) =>
      Array.from(tr.querySelectorAll('td')).map((td) => td.textContent?.trim() ?? ''),
    );

    expect(rows).toContainEqual(['DESC', 'old-desc', 'new-desc']);
    expect(rows).toContainEqual(['XLEN', '100', '—']);
    expect(rows).toContainEqual(['WIDT', '—', '50']);
    expect(rows).toContainEqual(['att.HEIG', '10', '20']);
    // unchanged 属性不出行
    expect(rows.some((cells) => cells[0] === 'noun')).toBe(false);
    // 面板保留原 testid，且不再有「示例」徽标
    expect(host.querySelector('[data-testid="model-tree-diff-attr-panel"]')).not.toBeNull();
    expect(host.textContent).not.toContain('示例');
  });

  it('shows "—" on the after side for a deleted node (to snapshot missing)', async () => {
    resolveAnchorMock.mockImplementation(async (_dbnum, sesno) => anchor(sesno));
    getSnapshotMock.mockImplementation(async (_dbnum, sesno) => {
      if (sesno === FROM_SESNO) return snapshot(sesno, { noun: 'BOX', DESC: 'gone' });
      return snapshot(sesno, null);
    });
    const host = mountPanel(defaultProps({
      model: { refno: REFNO, status: 'deleted', category: 'BOX' },
      canLocate: false,
    }));
    await waitForAsyncUi();

    const rows = Array.from(host.querySelectorAll('[data-testid="attr-diff-table"] tbody tr')).map((tr) =>
      Array.from(tr.querySelectorAll('td')).map((td) => td.textContent?.trim() ?? ''),
    );
    expect(rows).toContainEqual(['DESC', 'gone', '—']);
    expect(rows).toContainEqual(['noun', 'BOX', '—']);
  });

  it('hints when resolve-anchor falls back to a nearest anchor (exact=false)', async () => {
    resolveAnchorMock.mockImplementation(async (_dbnum, sesno) =>
      (sesno === TO_SESNO ? anchor(890, false) : anchor(sesno)));
    getSnapshotMock.mockImplementation(async (_dbnum, sesno) =>
      snapshot(sesno, { noun: 'BOX', DESC: `v${sesno}` }));
    const host = mountPanel();
    await waitForAsyncUi();

    const hint = host.querySelector('[data-testid="attr-diff-anchor-fallback"]');
    expect(hint?.textContent).toContain('已回退到 sesno 890');
    // 回退后 snapshot 用解析出的锚点 sesno
    expect(getSnapshotMock).toHaveBeenCalledWith(
      DBNUM, 890, REFNO, undefined, expect.anything(),
    );
  });

  it('degrades to 「历史已过期」 on HTTP 410 ExpiredError without demo fallback', async () => {
    resolveAnchorMock.mockImplementation(async (_dbnum, sesno) => anchor(sesno));
    getSnapshotMock.mockRejectedValue(new ExpiredError('该 sesno 历史已超出 retention 窗口', 410));
    const host = mountPanel();
    await waitForAsyncUi();

    const unavailable = host.querySelector('[data-testid="attr-diff-unavailable"]');
    expect(unavailable?.textContent).toContain('属性差异暂不可用');
    expect(unavailable?.textContent).toContain('历史已过期');
    expect(host.querySelector('[data-testid="attr-diff-table"]')).toBeNull();
    expect(host.textContent).not.toContain('示例');
  });

  it('degrades to 「锚点缺失」 on HTTP 404 AnchorMissingError without demo fallback', async () => {
    resolveAnchorMock.mockRejectedValue(
      new AnchorMissingError('未找到 dbnum=1112 sesno<=896 的 sesno_version_anchor', 404),
    );
    const host = mountPanel();
    await waitForAsyncUi();

    const unavailable = host.querySelector('[data-testid="attr-diff-unavailable"]');
    expect(unavailable?.textContent).toContain('属性差异暂不可用');
    expect(unavailable?.textContent).toContain('锚点缺失');
    expect(getSnapshotMock).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain('示例');
  });

  it('degrades to 「暂不可用 + 原因」 on other failures (non-versioned site)', async () => {
    resolveAnchorMock.mockRejectedValue(new Error('list_anchors failed: versioned=false'));
    const host = mountPanel();
    await waitForAsyncUi();

    const unavailable = host.querySelector('[data-testid="attr-diff-unavailable"]');
    expect(unavailable?.textContent).toContain('属性差异暂不可用');
    expect(unavailable?.textContent).toContain('versioned=false');
    expect(host.textContent).not.toContain('示例');
  });

  it('degrades when version context (dbnum/sesno) is missing, without calling the api', async () => {
    const host = mountPanel(defaultProps({ dbnum: undefined }));
    await waitForAsyncUi();

    expect(host.querySelector('[data-testid="attr-diff-unavailable"]')?.textContent)
      .toContain('缺少版本上下文');
    expect(resolveAnchorMock).not.toHaveBeenCalled();
    expect(getSnapshotMock).not.toHaveBeenCalled();
  });
});
