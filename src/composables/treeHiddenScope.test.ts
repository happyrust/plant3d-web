/**
 * 装载流程向模型树问「藏着的那部分名下现在有哪些构件」的传话处（`treeHiddenScope`）。这里只盯传话本身：
 * 谁登记、谁撤、问不到时回什么、被叫停时等不等。树怎么答见 `usePdmsOwnerTree.hiddenScope.test.ts`，
 * 装载流程拿到答案怎么用见 `useModelGeneration.genModelV1.test.ts`。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  provideTreeHiddenScope,
  queryTreeHiddenScope,
  type TreeHiddenScope,
  type TreeHiddenScopeProvider,
} from './treeHiddenScope';

const cleanups: (() => void)[] = [];

function provide(provider: TreeHiddenScopeProvider): () => void {
  const off = provideTreeHiddenScope(provider);
  cleanups.push(off);
  return off;
}

function scopeOf(...refnos: string[]): TreeHiddenScope {
  return { refnos: new Set(refnos), failed: [] };
}

afterEach(() => {
  for (const off of cleanups.splice(0)) off();
  vi.restoreAllMocks();
});

describe('treeHiddenScope：装载流程向模型树问藏着的部分', () => {
  it('没有树登记：回 null', async () => {
    expect(await queryTreeHiddenScope('1_1')).toBeNull();
  });

  it('登记之后问得到；节点和叫停信号原样交给树', async () => {
    const answer = scopeOf('1_2', '1_3');
    const tree = vi.fn<TreeHiddenScopeProvider>(async () => answer);
    provide(tree);
    const controller = new AbortController();

    expect(await queryTreeHiddenScope('1_1', controller.signal)).toBe(answer);

    expect(tree).toHaveBeenCalledTimes(1);
    expect(tree).toHaveBeenCalledWith('1_1', controller.signal);
  });

  it('后登记的顶掉先登记的；先登记的再撤不影响后登记的；都撤了就问不到', async () => {
    const first = vi.fn<TreeHiddenScopeProvider>(async () => scopeOf('first'));
    const second = vi.fn<TreeHiddenScopeProvider>(async () => scopeOf('second'));
    const offFirst = provide(first);
    const offSecond = provide(second);

    expect([...(await queryTreeHiddenScope('1_1'))!.refnos]).toEqual(['second']);

    offFirst();
    expect([...(await queryTreeHiddenScope('1_1'))!.refnos]).toEqual(['second']);
    expect(first).not.toHaveBeenCalled();

    offSecond();
    expect(await queryTreeHiddenScope('1_1')).toBeNull();
    expect(second).toHaveBeenCalledTimes(2);
  });

  it('树那边出错（拒绝 / 当场抛错）：回 null，不往外抛', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    provide(async () => {
      throw new Error('后端不通');
    });
    expect(await queryTreeHiddenScope('1_1')).toBeNull();

    provide((): never => {
      throw new Error('当场抛的');
    });
    expect(await queryTreeHiddenScope('1_1')).toBeNull();

    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('问到一半被叫停：当场回 null，不等树那边在途的查询', async () => {
    let answer!: (scope: TreeHiddenScope) => void;
    const tree = vi.fn<TreeHiddenScopeProvider>(() => new Promise((resolve) => {
      answer = resolve;
    }));
    provide(tree);
    const controller = new AbortController();
    let settled: TreeHiddenScope | null | 'pending' = 'pending';

    const asked = queryTreeHiddenScope('1_1', controller.signal).then((scope) => {
      settled = scope;
      return scope;
    });
    await vi.waitFor(() => expect(tree).toHaveBeenCalledTimes(1));
    expect(settled).toBe('pending');

    controller.abort();
    expect(await asked).toBeNull();

    // 之后树那边才答上来：没人要了，也不出错
    answer(scopeOf('1_2'));
    await Promise.resolve();
    expect(settled).toBeNull();
  });

  it('问之前就已经被叫停：不去打扰树', async () => {
    const tree = vi.fn<TreeHiddenScopeProvider>(async () => scopeOf('1_2'));
    provide(tree);
    const controller = new AbortController();
    controller.abort();

    expect(await queryTreeHiddenScope('1_1', controller.signal)).toBeNull();

    expect(tree).not.toHaveBeenCalled();
  });

  it('正常答完：叫停信号上不留监听（一次装载里信号一直在，监听不能越挂越多）', async () => {
    provide(async () => scopeOf('1_2'));
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');

    await queryTreeHiddenScope('1_1', controller.signal);

    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]![1]);
  });
});
