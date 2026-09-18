import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick } from 'vue';

import ModelVersionAttrDiffPanel from './ModelVersionAttrDiffPanel.vue';

import type { TreeDiffAttributesAt } from '@/composables/useTreeVersionDiff';
import type { ModelVersionAttributeRow, ModelVersionAttributes } from '@/model-source/ports';

function row(name: string, display: string, extra: Partial<ModelVersionAttributeRow> = {}): ModelVersionAttributeRow {
  return { name, valueType: 'string', display, isUnset: false, isUda: false, ...extra };
}

function side(sesno: number, attributes: ModelVersionAttributeRow[], exists = true): ModelVersionAttributes {
  return { sesno, exists, noun: exists ? 'ELBO' : null, attributes };
}

async function flushUi(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await Promise.resolve();
    await nextTick();
  }
}

type MountProps = {
  model: { refno: string; status?: string };
  fromSesno?: number;
  toSesno?: number;
  attributesAt?: TreeDiffAttributesAt;
  onLocate?: (refno: string) => void;
};

function mount(props: MountProps) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp(ModelVersionAttrDiffPanel, props);
  app.mount(host);
  return { host, app };
}

describe('ModelVersionAttrDiffPanel', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('两侧都取到：只列有差异的行，「显示未变」勾上后全列；表头带 A / B 的 sesno', async () => {
    const attributesAt = vi.fn<TreeDiffAttributesAt>(async (which) => (which === 'before'
      ? side(587, [row('NAME', '/BOX1'), row('POS', '0 0 0'), row('DESC', '', { isUnset: true })])
      : side(602, [row('NAME', '/BOX1'), row('POS', '0 0 10'), row('DESC', 'moved')])));
    const { host, app } = mount({ model: { refno: '24384_26481', status: 'modified' }, fromSesno: 587, toSesno: 602, attributesAt });
    await flushUi();

    expect(attributesAt).toHaveBeenCalledTimes(2);
    expect(attributesAt.mock.calls.map(([which, refno]) => [which, refno])).toEqual([['before', '24384_26481'], ['after', '24384_26481']]);
    expect(host.textContent).toContain('A · sesno 587');
    expect(host.textContent).toContain('B · sesno 602');
    expect(host.querySelector('[data-testid="attr-diff-count"]')?.textContent).toContain('变更 2 / 3');

    const statuses = () => [...host.querySelectorAll('tr[data-attr-status]')].map((tr) => tr.getAttribute('data-attr-status'));
    expect(statuses()).toEqual(['changed', 'changed']);
    expect(host.textContent).toContain('unset');
    expect(host.textContent).toContain('moved');

    const toggle = host.querySelector('[data-testid="attr-diff-show-unchanged"]') as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    await flushUi();
    expect(statuses()).toEqual(['unchanged', 'changed', 'changed']);

    app.unmount();
  });

  it('B 侧 exists:false（已删除）：给「该构件在版本 B 不存在」横幅，A 侧的属性全部列为 only-before', async () => {
    const attributesAt = vi.fn<TreeDiffAttributesAt>(async (which) => (which === 'before'
      ? side(602, [row('NAME', '/BOX1'), row('POS', '0 0 10')])
      : side(604, [], false)));
    const { host, app } = mount({ model: { refno: '24384_26481', status: 'deleted' }, fromSesno: 602, toSesno: 604, attributesAt });
    await flushUi();

    expect(host.querySelector('[data-testid="attr-diff-missing-side"]')?.textContent).toContain('版本 B 不存在');
    expect([...host.querySelectorAll('tr[data-attr-status]')].map((tr) => tr.getAttribute('data-attr-status'))).toEqual(['only-before', 'only-before']);
    app.unmount();
  });

  it('两侧字都一样：表格给「属性无差异」', async () => {
    const attributesAt = vi.fn<TreeDiffAttributesAt>(async () => side(1, [row('NAME', '/BOX1')]));
    const { host, app } = mount({ model: { refno: '1_1', status: 'modified' }, attributesAt });
    await flushUi();
    expect(host.querySelector('[data-testid="attr-diff-empty"]')?.textContent).toContain('属性无差异');
    app.unmount();
  });

  it('取数抛错（后端还没有 tool=attributes 时就是这样）→「属性历史对比暂不可用」+ 原因，不是白屏', async () => {
    const attributesAt = vi.fn<TreeDiffAttributesAt>(async () => {
      throw new Error('unknown historical query tool "attributes"');
    });
    const { host, app } = mount({ model: { refno: '1_1', status: 'modified' }, attributesAt });
    await flushUi();
    const unavailable = host.querySelector('[data-testid="attr-diff-unavailable"]');
    expect(unavailable?.textContent).toContain('暂不可用');
    expect(unavailable?.textContent).toContain('unknown historical query tool');
    app.unmount();
  });

  it('「在 3D 中定位」按钮 emit locate(refno)——幽灵节点也能点（被删构件在 A 层）', async () => {
    const attributesAt = vi.fn<TreeDiffAttributesAt>(async (which) => side(1, which === 'before' ? [row('NAME', '/BOX1')] : [], which === 'before'));
    const located: string[] = [];
    const { host, app } = mount({
      model: { refno: '24384_26481', status: 'deleted' },
      attributesAt,
      onLocate: (refno) => located.push(refno),
    });
    await flushUi();

    const button = host.querySelector('[data-testid="attr-diff-locate"]') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    button.click();
    expect(located).toEqual(['24384_26481']);
    app.unmount();
  });

  it('没有取数口的上下文：提示重新运行版本对比，不打任何请求', async () => {
    const { host, app } = mount({ model: { refno: '1_1', status: 'modified' } });
    await flushUi();
    expect(host.querySelector('[data-testid="attr-diff-unavailable"]')?.textContent).toContain('重新运行版本对比');
    app.unmount();
  });
});
