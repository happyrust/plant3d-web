import { beforeEach, describe, expect, it } from 'vitest';

import { useModelLoadStatus } from './useModelLoadStatus';

const status = useModelLoadStatus();

/** 状态条此刻的样子 */
function bar() {
  return status.state.value;
}

beforeEach(() => {
  status.reset();
});

describe('加载状态条：只有一个加载时和原来一样', () => {
  it('开始就显示，改进度跟着变（没给的字段保持原样），结束收起、留着最后的文案', () => {
    expect(bar().visible).toBe(false);

    const load = status.begin({ message: '准备加载模型...', currentRefno: '24381_100', stopKey: '24381_100' });
    expect(bar()).toEqual({
      visible: true, progress: 0, message: '准备加载模型...', currentRefno: '24381_100', error: null, stopKey: '24381_100',
    });

    load.update({ message: '查询记录', progress: 30 });
    expect(bar()).toMatchObject({ visible: true, progress: 30, message: '查询记录', currentRefno: '24381_100', stopKey: '24381_100' });

    load.update({ currentRefno: '24381_101' });
    expect(bar()).toMatchObject({ progress: 30, message: '查询记录', currentRefno: '24381_101' });

    load.finish({ message: '加载完成' });
    expect(bar()).toEqual({
      visible: false, progress: 100, message: '加载完成', currentRefno: '24381_101', error: null, stopKey: null,
    });
  });

  it('带着错误结束：进度停在出错时的位置，错误留着；重复结束只算第一次', () => {
    const load = status.begin({ message: '装载' });
    load.update({ progress: 42 });

    load.finish({ message: '加载失败', error: '网络错误' });
    expect(bar()).toMatchObject({ visible: false, progress: 42, message: '加载失败', error: '网络错误' });
    expect(status.hasError.value).toBe(true);

    load.finish({ message: '又结束了一次' });
    expect(bar()).toMatchObject({ visible: false, progress: 42, message: '加载失败', error: '网络错误' });
  });

  it('进度收在 0–100 的整数', () => {
    const load = status.begin({ progress: -5 });
    expect(bar().progress).toBe(0);
    load.update({ progress: 33.6 });
    expect(bar().progress).toBe(34);
    load.update({ progress: 250 });
    expect(bar().progress).toBe(100);
    load.update({ progress: Number.NaN });
    expect(bar().progress).toBe(0);
  });

  it('新的加载开始时不带着上一个加载留下的错误', () => {
    status.begin({ message: '第一个' }).finish({ message: '加载失败', error: '出错了' });
    expect(bar().error).toBe('出错了');

    status.begin({ message: '第二个' });
    expect(bar()).toMatchObject({ visible: true, message: '第二个', error: null });
  });
});

describe('加载状态条：几个加载同时在跑，各记各的，结束只拿掉自己那条（#164）', () => {
  it('先开始的先结束：状态条不收起，换成还在跑的那个，「停」认的节点跟着换', () => {
    const first = status.begin({ message: '加载 A', currentRefno: 'A', stopKey: 'A' });
    const second = status.begin({ message: '加载 B', currentRefno: 'B', stopKey: 'B' });
    second.update({ message: 'B 查询记录', progress: 30 });

    first.finish({ message: 'A 加载完成' });

    expect(bar()).toEqual({ visible: true, progress: 30, message: 'B 查询记录', currentRefno: 'B', error: null, stopKey: 'B' });

    second.update({ progress: 60 });
    expect(bar()).toMatchObject({ visible: true, progress: 60, stopKey: 'B' });

    second.finish({ message: 'B 加载完成' });
    expect(bar()).toMatchObject({ visible: false, progress: 100, message: 'B 加载完成', stopKey: null });
  });

  it('后开始的先结束：状态条一直是先开始的那个，「停」还在，文案和进度不被带走', () => {
    const first = status.begin({ message: '加载 A', currentRefno: 'A', stopKey: 'A' });
    first.update({ message: 'A 装入第 2/3 批', progress: 56 });
    const second = status.begin({ message: '加载 B', currentRefno: 'B', stopKey: 'B' });

    second.finish({ message: 'B 加载完成' });

    expect(bar()).toEqual({ visible: true, progress: 56, message: 'A 装入第 2/3 批', currentRefno: 'A', error: null, stopKey: 'A' });

    first.update({ progress: 80 });
    expect(bar()).toMatchObject({ visible: true, progress: 80, stopKey: 'A' });
  });

  it('后开始的加载写进度：不盖掉状态条上正显示的那一条；轮到它时显示的是它自己最新的进度', () => {
    const first = status.begin({ message: 'A 装载中', currentRefno: 'A', stopKey: 'A' });
    first.update({ progress: 70 });
    const second = status.begin({ message: '加载 B', currentRefno: 'B', stopKey: 'B' });

    second.update({ message: 'gen-model 查询记录：3/3 个生成根', progress: 30, currentRefno: 'B_3' });
    expect(bar()).toEqual({ visible: true, progress: 70, message: 'A 装载中', currentRefno: 'A', error: null, stopKey: 'A' });

    second.update({ message: 'B 装载中', progress: 45 });
    first.finish();
    expect(bar()).toEqual({ visible: true, progress: 45, message: 'B 装载中', currentRefno: 'B_3', error: null, stopKey: 'B' });
  });

  it('已经结束的加载再写进度：不起作用，收起来的状态条不会被拉出来，也不改别人的那一条', () => {
    const first = status.begin({ message: '加载 A', stopKey: 'A' });
    first.finish({ message: 'A 加载完成' });

    first.update({ message: 'A 迟到的进度', progress: 50 });
    expect(bar()).toMatchObject({ visible: false, message: 'A 加载完成', stopKey: null });

    const second = status.begin({ message: '加载 B', stopKey: 'B' });
    first.update({ message: 'A 迟到的进度', progress: 50 });
    first.finish({ message: 'A 又结束了一次' });
    expect(bar()).toMatchObject({ visible: true, progress: 0, message: '加载 B', stopKey: 'B' });

    second.finish();
    expect(bar().visible).toBe(false);
  });

  it('三个加载：中间的先结束不影响状态条，之后按开始的先后一个个轮到', () => {
    const a = status.begin({ message: 'A', stopKey: 'A' });
    const b = status.begin({ message: 'B', stopKey: 'B' });
    const c = status.begin({ message: 'C', stopKey: 'C' });

    b.finish();
    expect(bar()).toMatchObject({ visible: true, message: 'A', stopKey: 'A' });

    a.finish();
    expect(bar()).toMatchObject({ visible: true, message: 'C', stopKey: 'C' });

    c.finish({ message: 'C 加载完成' });
    expect(bar()).toMatchObject({ visible: false, message: 'C 加载完成', stopKey: null });
  });

  it('不能停的加载（整库显示，没有 stopKey）在前、节点显示在后：整库结束后轮到节点，「停」认的节点出现', () => {
    const whole = status.begin({ message: '准备按 dbnum 加载模型...' });
    const node = status.begin({ message: '加载节点', stopKey: '24381_100' });
    expect(bar()).toMatchObject({ visible: true, message: '准备按 dbnum 加载模型...', stopKey: null });

    whole.finish({ message: 'Model loaded (gen-model)' });
    expect(bar()).toMatchObject({ visible: true, message: '加载节点', stopKey: '24381_100' });

    node.finish();
    expect(bar().visible).toBe(false);
  });

  it('先开始的那个带着错误结束：状态条换成还在跑的那个，不显示别人的错误', () => {
    const first = status.begin({ message: '加载 A', stopKey: 'A' });
    const second = status.begin({ message: '加载 B', stopKey: 'B' });

    first.finish({ message: '加载失败', error: 'A 出错了' });

    expect(bar()).toMatchObject({ visible: true, message: '加载 B', error: null, stopKey: 'B' });
    second.finish();
    expect(bar()).toMatchObject({ visible: false, error: null });
  });
});
