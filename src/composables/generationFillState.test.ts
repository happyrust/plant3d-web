import { beforeEach, describe, expect, it } from 'vitest';
import { computed } from 'vue';

import {
  __resetGenerationFillStateForTests,
  beginGenerationFill,
  clearPendingGenerationFill,
  isGenerationFillActive,
  notePendingGenerationFill,
  pendingGenerationFill,
  pendingGenerationFillView,
} from './generationFillState';

beforeEach(() => {
  __resetGenerationFillStateForTests();
});

describe('还没补齐的节点', () => {
  it('记下之后行上有「生成」按钮：写明还有多少、为什么没补齐', () => {
    expect(pendingGenerationFillView('24381_535')).toBeNull();
    notePendingGenerationFill({ root: '24381_535', dbnum: 7997, chunks: 2, units: 26, exact: false, reason: 'declined' }, 1_000);
    expect(pendingGenerationFill('24381_535')).toMatchObject({ dbnum: 7997, chunks: 2, units: 26, reason: 'declined', notedAt: 1_000 });
    expect(pendingGenerationFillView('24381_535')).toEqual({
      busy: false,
      label: '生成',
      title: '这个节点下还有约 26 个单元没有模型（分在 2 块里），上次选了先不生成。点「生成」补齐：不重算已有的，做完一块显示一块',
    });
  });

  it.each([
    ['pending', '后端上次没做完'],
    ['stopped', '上次中途停了'],
  ] as const)('原因 %s 写成「%s」；只有一块时不写「分在几块里」；精确的数不写「约」', (reason, text) => {
    notePendingGenerationFill({ root: '24381_536', dbnum: 7997, chunks: 1, units: 8, exact: true, reason });
    const title = pendingGenerationFillView('24381_536')!.title;
    expect(title).toContain(`还有 8 个单元没有模型，${text}`);
    expect(title).not.toContain('分在');
  });

  it('补齐之后撤掉；视图是响应式的', () => {
    const view = computed(() => pendingGenerationFillView('24381_535'));
    expect(view.value).toBeNull();
    notePendingGenerationFill({ root: '24381_535', dbnum: 7997, chunks: 1, units: 3, exact: false, reason: 'pending' });
    expect(view.value?.label).toBe('生成');
    clearPendingGenerationFill('24381_535');
    expect(view.value).toBeNull();
  });
});

describe('正在补齐的节点', () => {
  // 叫停不在这里：分块生成是「显示这个节点」的一段，停它走加载会话（modelLoadSession.test.ts）
  it('进行中：按钮写「生成中」；结束后撤掉', () => {
    notePendingGenerationFill({ root: '24381_535', dbnum: 7997, chunks: 2, units: 26, exact: false, reason: 'declined' });
    const fill = beginGenerationFill('24381_535');
    expect(isGenerationFillActive('24381_535')).toBe(true);
    expect(pendingGenerationFillView('24381_535')).toMatchObject({ busy: true, label: '生成中' });

    fill.end();
    expect(isGenerationFillActive('24381_535')).toBe(false);
    expect(pendingGenerationFillView('24381_535')).toMatchObject({ busy: false, label: '生成' });
  });

  it('上一次的 end 晚到，不会把同一个节点新开的这一次撤掉', () => {
    const first = beginGenerationFill('24381_535', 1_000);
    const second = beginGenerationFill('24381_535', 2_000);
    first.end();
    expect(isGenerationFillActive('24381_535')).toBe(true);
    second.end();
    expect(isGenerationFillActive('24381_535')).toBe(false);
  });
});
