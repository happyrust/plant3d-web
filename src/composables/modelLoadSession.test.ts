import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed } from 'vue';

import {
  ModelLoadStoppedError,
  __resetModelLoadSessionsForTests,
  beginModelLoadSession,
  consumeModelLoadStopped,
  modelLoadSessionView,
  noteModelLoadWithdrawn,
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
    expect(view.value).toEqual({ stoppable: true, stopping: false, queued: false });
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
    expect(modelLoadSessionView('24383_80211')).toEqual({ stoppable: false, stopping: true, queued: false });

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
    expect(modelLoadSessionView('24381_571')).toEqual({ stoppable: false, stopping: false, queued: false });
    expect(requestStopModelLoad('24381_571')).toBe(false);
    expect(session.stopped).toBe(false);
    session.end();
  });

  it('中途可以改成不能停 / 又能停（整套替换已经开始的那一小段）', () => {
    const session = beginModelLoadSession('24381_571');
    session.setStoppable(false);
    expect(modelLoadSessionView('24381_571')).toEqual({ stoppable: false, stopping: false, queued: false });
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
    expect(modelLoadSessionView('17496_8516')).toEqual({ stoppable: true, stopping: false, queued: false });
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

describe('排队：同一时刻只有一个节点在真正加载，其余的按点击的先后等轮到（#166）', () => {
  const A = '24383_80211';
  const B = '17496_8516';
  const C = '24381_571';
  const D = '24381_535';

  /** 让出一轮：微任务都跑完 */
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  /** 记下这一次等待的结果（还没结果为 `null`） */
  function watch(turn: true | Promise<boolean>): { granted: boolean | null } {
    const seen: { granted: boolean | null } = { granted: null };
    void Promise.resolve(turn).then((granted) => { seen.granted = granted; });
    return seen;
  }

  it('没有别的节点在跑：当场轮到（同步回 true，不多等一拍），行上不算排队', () => {
    const session = beginModelLoadSession(A);
    expect(session.waitTurn()).toBe(true);
    expect(modelLoadSessionView(A)).toEqual({ stoppable: true, stopping: false, queued: false });
    // 已经轮到的再问还是它的
    expect(session.waitTurn()).toBe(true);
  });

  it('前面有人在跑：后来的按点击的先后排队，行上知道它在排队；前一个结束才轮到下一个', async () => {
    const first = beginModelLoadSession(A);
    expect(first.waitTurn()).toBe(true);
    const second = beginModelLoadSession(B);
    const third = beginModelLoadSession(C);
    const secondTurn = watch(second.waitTurn());
    const thirdTurn = watch(third.waitTurn());
    const viewB = computed(() => modelLoadSessionView(B));
    expect(viewB.value).toEqual({ stoppable: true, stopping: false, queued: true });
    expect(modelLoadSessionView(C)).toEqual({ stoppable: true, stopping: false, queued: true });

    await flush();
    expect([secondTurn.granted, thirdTurn.granted]).toEqual([null, null]);

    first.end();
    await flush();
    expect([secondTurn.granted, thirdTurn.granted]).toEqual([true, null]);
    // 行上跟着变：轮到的不再算排队，后面的还在排
    expect(viewB.value).toEqual({ stoppable: true, stopping: false, queued: false });
    expect(modelLoadSessionView(C)).toEqual({ stoppable: true, stopping: false, queued: true });

    second.end();
    await flush();
    expect(thirdTurn.granted).toBe(true);

    // 都结束了：下一个又是当场轮到
    third.end();
    expect(beginModelLoadSession(D).waitTurn()).toBe(true);
  });

  it('排队中被叫停：当场出队、得到 false，不用等前面的跑完；在跑的不受影响，排在它后面的照常轮到', async () => {
    const first = beginModelLoadSession(A);
    first.waitTurn();
    const second = beginModelLoadSession(B);
    const third = beginModelLoadSession(C);
    const secondTurn = watch(second.waitTurn());
    const thirdTurn = watch(third.waitTurn());

    expect(requestStopModelLoad(B)).toBe(true);
    await flush();
    expect(secondTurn.granted).toBe(false);
    expect(second.stopped).toBe(true);
    expect(second.signal.aborted).toBe(true);
    expect(modelLoadSessionView(B)).toEqual({ stoppable: false, stopping: true, queued: false });
    second.end();
    expect(modelLoadSessionView(B)).toBeNull();
    // 在跑的那个没动，第三个还在等它
    expect(first.stopped).toBe(false);
    expect(thirdTurn.granted).toBeNull();

    first.end();
    await flush();
    expect(thirdTurn.granted).toBe(true);
  });

  it('排队中的一律能停：不能停的加载（重新生成）排队时也能停——还什么都没发给后端；轮到的那一刻起不能停', async () => {
    const first = beginModelLoadSession(A);
    first.waitTurn();
    const stoppedWhileQueued = beginModelLoadSession(B, { stoppable: false });
    const reachesItsTurn = beginModelLoadSession(C, { stoppable: false });
    const stoppedTurn = watch(stoppedWhileQueued.waitTurn());
    const reachedTurn = watch(reachesItsTurn.waitTurn());
    expect(modelLoadSessionView(B)).toEqual({ stoppable: true, stopping: false, queued: true });

    expect(requestStopModelLoad(B)).toBe(true);
    await flush();
    expect(stoppedTurn.granted).toBe(false);
    stoppedWhileQueued.end();

    first.end();
    await flush();
    expect(reachedTurn.granted).toBe(true);
    expect(modelLoadSessionView(C)).toEqual({ stoppable: false, stopping: false, queued: false });
    expect(requestStopModelLoad(C)).toBe(false);
    expect(reachesItsTurn.stopped).toBe(false);
  });

  it('在跑的那个被叫停：它把这次画出来的收回去、结束之后，才轮到下一个', async () => {
    const first = beginModelLoadSession(A);
    first.waitTurn();
    const second = beginModelLoadSession(B);
    const secondTurn = watch(second.waitTurn());

    expect(requestStopModelLoad(A)).toBe(true);
    await flush();
    // 先点的还在收尾：这一轮还是它的
    expect(secondTurn.granted).toBeNull();
    expect(modelLoadSessionView(B)).toEqual({ stoppable: true, stopping: false, queued: true });

    first.markWithdrawn();
    first.end();
    await flush();
    expect(secondTurn.granted).toBe(true);
    expect(second.stopped).toBe(false);
  });

  it('同一个节点有两路（两份显示流程各点了一次），一路在跑、一路排队：行上不算排队；叫停时两路一起停，排队的那路当场出队', async () => {
    const running = beginModelLoadSession(A);
    running.waitTurn();
    const waiting = beginModelLoadSession(A);
    const waitingTurn = watch(waiting.waitTurn());
    expect(modelLoadSessionView(A)).toEqual({ stoppable: true, stopping: false, queued: false });

    expect(requestStopModelLoad(A)).toBe(true);
    await flush();
    expect(running.stopped).toBe(true);
    expect(waiting.stopped).toBe(true);
    expect(waitingTurn.granted).toBe(false);
  });

  it('没轮到就结束了：出队，不占位置；它的结束不会把别人占着的这一轮交出去，重复结束也不会', async () => {
    const first = beginModelLoadSession(A);
    first.waitTurn();
    const second = beginModelLoadSession(B);
    const third = beginModelLoadSession(C);
    const secondTurn = watch(second.waitTurn());
    const thirdTurn = watch(third.waitTurn());

    second.end();
    second.end();
    await flush();
    expect(secondTurn.granted).toBe(false);
    // 第一个还在跑：第三个照旧等着
    expect(thirdTurn.granted).toBeNull();

    first.end();
    first.end();
    await flush();
    expect(thirdTurn.granted).toBe(true);
    // 第三个占着这一轮：再来的要排队
    const fourth = beginModelLoadSession(D);
    expect(fourth.waitTurn()).not.toBe(true);
    expect(modelLoadSessionView(D)).toEqual({ stoppable: true, stopping: false, queued: true });
  });

  it('已经被叫停的不再排队：得到 false，不占这一轮', async () => {
    const session = beginModelLoadSession(A);
    session.stop();
    const turn = watch(session.waitTurn());
    await flush();
    expect(turn.granted).toBe(false);
    expect(beginModelLoadSession(B).waitTurn()).toBe(true);
  });

  it('排队时重复问：拿到的是同一次等待，不会排两次', async () => {
    const first = beginModelLoadSession(A);
    first.waitTurn();
    const second = beginModelLoadSession(B);
    const waiting = second.waitTurn();
    expect(second.waitTurn()).toBe(waiting);
    const third = beginModelLoadSession(C);
    const thirdTurn = watch(third.waitTurn());

    first.end();
    await flush();
    expect(second.waitTurn()).toBe(true);
    expect(thirdTurn.granted).toBeNull();
    // 第二个只排了一次：它结束之后轮到的就是第三个
    second.end();
    await flush();
    expect(thirdTurn.granted).toBe(true);
  });

  it('没排过队的加载（不走排队的调用方）结束：不动别人的轮次', async () => {
    const first = beginModelLoadSession(A);
    first.waitTurn();
    const second = beginModelLoadSession(B);
    const secondTurn = watch(second.waitTurn());
    const bystander = beginModelLoadSession(C);

    bystander.end();
    await flush();
    expect(secondTurn.granted).toBeNull();
  });

  it('测试复位：排队一起清掉', () => {
    beginModelLoadSession(A).waitTurn();
    void beginModelLoadSession(B).waitTurn();
    __resetModelLoadSessionsForTests();
    expect(beginModelLoadSession(C).waitTurn()).toBe(true);
  });
});

describe('被叫停的那一次显示：发起的一方问一次就清掉', () => {
  it('显示流程收尾时记一笔；模型树的眼睛据此不再把节点同步成可见', () => {
    const session = beginModelLoadSession('24383_80211');
    expect(session.withdrawn).toBe(false);
    expect(consumeModelLoadStopped('24383_80211')).toBe(false);
    requestStopModelLoad('24383_80211');
    session.markWithdrawn();
    expect(session.withdrawn).toBe(true);
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

  it('同一次显示有几位发起方在等（同一个节点又被点了一次，搭的是同一次，#166）：各记一笔，各问得到一次', () => {
    const session = beginModelLoadSession('24383_80211');
    requestStopModelLoad('24383_80211');
    session.markWithdrawn();
    // 搭车的那一位
    noteModelLoadWithdrawn('24383/80211');
    session.end();

    expect(consumeModelLoadStopped('24383_80211')).toBe(true);
    expect(consumeModelLoadStopped('24383_80211')).toBe(true);
    expect(consumeModelLoadStopped('24383_80211')).toBe(false);
  });

  it('同一次显示重复记：只算一笔', () => {
    const session = beginModelLoadSession('24383_80211');
    session.stop();
    session.markWithdrawn();
    session.markWithdrawn();
    expect(consumeModelLoadStopped('24383_80211')).toBe(true);
    expect(consumeModelLoadStopped('24383_80211')).toBe(false);
  });

  it('新的一次显示开始：这个节点之前没人来问的那几笔作废（有的发起方从来不问），别的节点的不动', () => {
    const stale = beginModelLoadSession('24383_80211');
    stale.stop();
    stale.markWithdrawn();
    noteModelLoadWithdrawn('24383_80211');
    stale.end();
    const other = beginModelLoadSession('17496_8516');
    other.stop();
    other.markWithdrawn();
    other.end();

    const next = beginModelLoadSession('24383_80211');
    expect(next.withdrawn).toBe(false);
    next.end();
    expect(consumeModelLoadStopped('24383_80211')).toBe(false);
    expect(consumeModelLoadStopped('17496_8516')).toBe(true);
  });
});

describe('有没有加载在进行（「取最新」据此等它们结束）', () => {
  it('按节点的加载：开始之后算有，全部结束之后才算没有', async () => {
    const { hasActiveModelLoad } = await import('./modelLoadSession');
    expect(hasActiveModelLoad()).toBe(false);
    const first = beginModelLoadSession('24383_80211');
    const second = beginModelLoadSession('24383_80300');
    expect(hasActiveModelLoad()).toBe(true);
    first.end();
    expect(hasActiveModelLoad()).toBe(true);
    second.end();
    expect(hasActiveModelLoad()).toBe(false);
  });

  it('整库显示没有按节点的会话：另记一笔；结束函数重复调不会多减', async () => {
    const { beginWholeLibraryLoad, hasActiveModelLoad } = await import('./modelLoadSession');
    const endFirst = beginWholeLibraryLoad();
    const endSecond = beginWholeLibraryLoad();
    expect(hasActiveModelLoad()).toBe(true);
    endFirst();
    endFirst();
    expect(hasActiveModelLoad()).toBe(true);
    endSecond();
    expect(hasActiveModelLoad()).toBe(false);
  });
});