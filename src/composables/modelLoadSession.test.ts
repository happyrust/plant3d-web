import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed } from 'vue';

import {
  ModelLoadStoppedError,
  __resetModelLoadSessionsForTests,
  beginModelLoadSession,
  consumeModelLoadStopped,
  modelLoadSessionView,
  requestStopModelLoad,
} from './modelLoadSession';

beforeEach(() => {
  __resetModelLoadSessionsForTests();
});

describe('加载会话：加载中可以停', () => {
  it('开始之后行上知道它在加载、能不能停；结束之后撤掉', () => {
    const view = computed(() => modelLoadSessionView('24383_80211'));
    expect(view.value).toBeNull();

    const session = beginModelLoadSession('24383_80211');
    expect(view.value).toEqual({ stoppable: true, stopping: false });
    expect(session.stopped).toBe(false);
    expect(session.signal.aborted).toBe(false);
    expect(() => session.throwIfStopped()).not.toThrow();

    session.end();
    expect(view.value).toBeNull();
    // 结束之后再叫停无效
    expect(requestStopModelLoad('24383_80211')).toBe(false);
  });

  it('叫停：信号立刻 abort，登记的收尾动作各跑一次，之后的检查点抛「已停止」', () => {
    const session = beginModelLoadSession('24383_80211');
    const cancelRecords = vi.fn();
    const other = vi.fn();
    session.onStop(cancelRecords);
    const undo = session.onStop(other);
    undo();

    expect(requestStopModelLoad('24383_80211')).toBe(true);
    expect(session.stopped).toBe(true);
    expect(session.signal.aborted).toBe(true);
    expect(cancelRecords).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
    expect(() => session.throwIfStopped()).toThrow(ModelLoadStoppedError);
    expect(modelLoadSessionView('24383_80211')).toEqual({ stoppable: false, stopping: true });

    // 再点一次不重复执行
    expect(requestStopModelLoad('24383_80211')).toBe(false);
    expect(cancelRecords).toHaveBeenCalledTimes(1);
  });

  it('叫停之后才登记的收尾动作当场执行（免得漏掉刚发出去的请求）', () => {
    const session = beginModelLoadSession('24383_80211');
    requestStopModelLoad('24383_80211');
    const late = vi.fn();
    session.onStop(late);
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('收尾动作抛错不影响叫停，也不影响别的收尾动作', () => {
    const session = beginModelLoadSession('24383_80211');
    const after = vi.fn();
    session.onStop(() => { throw new Error('boom'); });
    session.onStop(after);
    expect(requestStopModelLoad('24383_80211')).toBe(true);
    expect(after).toHaveBeenCalledTimes(1);
    expect(session.stopped).toBe(true);
  });

  it('不能停的加载（重新生成：后端已经在清旧模型）：行上知道它不能停，叫停无效', () => {
    const session = beginModelLoadSession('24381_571', { stoppable: false });
    expect(modelLoadSessionView('24381_571')).toEqual({ stoppable: false, stopping: false });
    expect(requestStopModelLoad('24381_571')).toBe(false);
    expect(session.stopped).toBe(false);
    session.end();
  });

  it('中途可以改成不能停 / 又能停（整套替换已经开始的那一小段）', () => {
    const session = beginModelLoadSession('24381_571');
    session.setStoppable(false);
    expect(modelLoadSessionView('24381_571')).toEqual({ stoppable: false, stopping: false });
    expect(requestStopModelLoad('24381_571')).toBe(false);
    session.setStoppable(true);
    expect(requestStopModelLoad('24381_571')).toBe(true);
  });

  it('叫停只管这个节点：别的节点的加载不受影响', () => {
    const site = beginModelLoadSession('24383_80211');
    const zone = beginModelLoadSession('17496_8516');
    requestStopModelLoad('24383_80211');
    expect(site.stopped).toBe(true);
    expect(zone.stopped).toBe(false);
    expect(modelLoadSessionView('17496_8516')).toEqual({ stoppable: true, stopping: false });
  });

  it('同一个节点同时有两路加载（模型树和查看器各有一份显示流程）：一起停；都结束了才撤掉', () => {
    const fromTree = beginModelLoadSession('24383_80211');
    const fromViewer = beginModelLoadSession('24383_80211');
    expect(requestStopModelLoad('24383_80211')).toBe(true);
    expect(fromTree.stopped).toBe(true);
    expect(fromViewer.stopped).toBe(true);
    fromTree.end();
    expect(modelLoadSessionView('24383_80211')).not.toBeNull();
    fromViewer.end();
    expect(modelLoadSessionView('24383_80211')).toBeNull();
  });

  it('节点号按 a_b 归一：a/b 也认', () => {
    const session = beginModelLoadSession('24383/80211');
    expect(modelLoadSessionView('24383_80211')).not.toBeNull();
    expect(requestStopModelLoad('24383/80211')).toBe(true);
    expect(session.stopped).toBe(true);
  });
});

describe('被叫停的那一次显示：发起的一方问一次就清掉', () => {
  it('显示流程收尾时记一笔；模型树的眼睛据此不再把节点同步成可见', () => {
    const session = beginModelLoadSession('24383_80211');
    expect(consumeModelLoadStopped('24383_80211')).toBe(false);
    requestStopModelLoad('24383_80211');
    session.markWithdrawn();
    session.end();
    expect(consumeModelLoadStopped('24383_80212')).toBe(false);
    expect(consumeModelLoadStopped('24383/80211')).toBe(true);
    expect(consumeModelLoadStopped('24383_80211')).toBe(false);
  });

  it('没有被叫停、只是显示流程自己判断「人不要这个节点了」（生成到一半节点被隐藏）也走这里', () => {
    const session = beginModelLoadSession('24381_535');
    session.stop();
    expect(session.stopped).toBe(true);
    expect(session.signal.aborted).toBe(true);
    session.markWithdrawn();
    expect(consumeModelLoadStopped('24381_535')).toBe(true);
  });
});
