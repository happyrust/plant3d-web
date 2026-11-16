import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

import { __resetConfirmDialogStoreForTests, useConfirmDialogStore } from './useConfirmDialogStore';

const dialog = useConfirmDialogStore();
const GENERATE = [{ id: 'generate', text: '生成并显示' }];

/** 现在弹着的是哪一问（没有在弹回 `null`） */
function shown(): { mode: string; message: string } | null {
  return dialog.visible.value ? { mode: dialog.mode.value, message: dialog.message.value } : null;
}

/** 让出一轮：答复的回调、「下一拍弹下一个」都跑完 */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** 盯着一个请求的答复：还没等到是 `'pending'` */
function track<T>(promise: Promise<T>): { value: T | 'pending' } {
  const box: { value: T | 'pending' } = { value: 'pending' };
  void promise.then((value) => { box.value = value; });
  return box;
}

beforeEach(() => {
  __resetConfirmDialogStoreForTests();
});

describe('全局确认弹窗：请求排队，一次弹一个（#163）', () => {
  it('只有一个请求时和原来一样：当场弹出，点了按钮拿到答复、弹窗关上', async () => {
    const confirmed = dialog.open({ title: '清空测量', message: '确定清空？', confirmText: '清空', cancelText: '不清' });
    expect(dialog.visible.value).toBe(true);
    expect(dialog.mode.value).toBe('confirm');
    expect(dialog.title.value).toBe('清空测量');
    expect(dialog.message.value).toBe('确定清空？');
    expect(dialog.confirmText.value).toBe('清空');
    expect(dialog.cancelText.value).toBe('不清');
    dialog.closeConfirm(true);
    expect(dialog.visible.value).toBe(false);
    expect(await confirmed).toBe(true);

    const choice = dialog.openChoice({ message: '要生成约 30 个单元', choices: GENERATE, cancelText: '只显示已有的' });
    expect(dialog.visible.value).toBe(true);
    expect(dialog.mode.value).toBe('choice');
    expect(dialog.title.value).toBe('提示');
    expect(dialog.choices.value).toEqual(GENERATE);
    expect(dialog.cancelText.value).toBe('只显示已有的');
    dialog.choose('generate');
    expect(dialog.visible.value).toBe(false);
    expect(await choice).toBe('generate');

    const declined = dialog.openChoice({ message: '要生成约 30 个单元', choices: GENERATE });
    dialog.cancelChoice();
    expect(await declined).toBeNull();
  });

  it('前一个还没答、后面的请求又来：不盖掉前一个，按发起的先后一个个弹，各自拿到自己的答复', async () => {
    const first = track(dialog.openChoice({ message: 'SITE A 要生成约 30 个单元', choices: GENERATE }));
    const second = track(dialog.openChoice({ message: 'SITE B 要生成约 50 个单元', choices: GENERATE }));
    const third = track(dialog.open({ message: '确定清空测量？' }));

    // 后来的不上屏：弹着的还是第一个
    expect(shown()).toEqual({ mode: 'choice', message: 'SITE A 要生成约 30 个单元' });

    dialog.choose('generate');
    await tick();
    expect(first.value).toBe('generate');
    expect(second.value).toBe('pending');
    expect(third.value).toBe('pending');
    expect(shown()).toEqual({ mode: 'choice', message: 'SITE B 要生成约 50 个单元' });

    dialog.cancelChoice();
    await tick();
    expect(second.value).toBeNull();
    expect(third.value).toBe('pending');
    expect(shown()).toEqual({ mode: 'confirm', message: '确定清空测量？' });

    dialog.closeConfirm(true);
    await tick();
    expect(third.value).toBe(true);
    expect(shown()).toBeNull();
  });

  it('答完一个之后弹窗先关上，下一拍再弹下一个（不在同一拍里关了又开）', async () => {
    void dialog.open({ message: '第一问' });
    void dialog.open({ message: '第二问' });

    dialog.closeConfirm(false);
    expect(shown()).toBeNull();
    await nextTick();
    expect(shown()).toEqual({ mode: 'confirm', message: '第二问' });
  });

  it('刚关掉一个的那一拍里新来的请求排在已经在等的后面，不插队', async () => {
    void dialog.open({ message: '第一问' });
    void dialog.open({ message: '第二问' });
    dialog.closeConfirm(true);
    void dialog.open({ message: '第三问' });
    expect(shown()).toBeNull();

    await tick();
    expect(shown()).toEqual({ mode: 'confirm', message: '第二问' });
    dialog.closeConfirm(true);
    await tick();
    expect(shown()).toEqual({ mode: 'confirm', message: '第三问' });
  });

  it('按 Esc / 点弹窗外面把弹窗关掉（v-dialog 直接把 visible 写成 false）：按取消结算正弹着的那一个，接着弹下一个', async () => {
    const first = track(dialog.openChoice({ message: 'SITE A', choices: GENERATE }));
    const second = track(dialog.open({ message: '第二问' }));

    dialog.visible.value = false;
    await tick();
    expect(first.value).toBeNull();
    expect(second.value).toBe('pending');
    expect(shown()).toEqual({ mode: 'confirm', message: '第二问' });

    dialog.visible.value = false;
    await tick();
    expect(second.value).toBe(false);
    expect(shown()).toBeNull();
  });

  it('按钮和弹着的那一问对不上（确认框的按钮点在选择框上，或反过来）：按取消结算，不留下等不到答复的请求', async () => {
    const choice = dialog.openChoice({ message: 'SITE A', choices: GENERATE });
    dialog.closeConfirm(true);
    expect(await choice).toBeNull();

    const confirmed = dialog.open({ message: '确定清空测量？' });
    dialog.choose('generate');
    expect(await confirmed).toBe(false);
    expect(shown()).toBeNull();
  });
});

describe('全局确认弹窗：排队期间发起方已经不需要这一问（#163）', () => {
  it('排队中的请求被 abort（加载被叫停）：当场出队、按取消结算，不用等前面的弹窗关；轮到它时不再弹', async () => {
    const stopped = new AbortController();
    const first = track(dialog.openChoice({ message: 'SITE A', choices: GENERATE }));
    const second = track(dialog.openChoice({ message: 'SITE B', choices: GENERATE, signal: stopped.signal }));
    const third = track(dialog.openChoice({ message: 'SITE C', choices: GENERATE }));

    stopped.abort();
    await tick();
    expect(second.value).toBeNull();
    expect(first.value).toBe('pending');
    expect(shown()).toEqual({ mode: 'choice', message: 'SITE A' });

    dialog.choose('generate');
    await tick();
    expect(first.value).toBe('generate');
    expect(shown()).toEqual({ mode: 'choice', message: 'SITE C' });

    dialog.choose('generate');
    await tick();
    expect(third.value).toBe('generate');
    expect(shown()).toBeNull();
  });

  it('正弹着的请求被 abort：弹窗关掉、按取消结算，接着弹下一个', async () => {
    const stopped = new AbortController();
    const first = track(dialog.open({ message: '第一问', signal: stopped.signal }));
    const second = track(dialog.open({ message: '第二问' }));

    stopped.abort();
    expect(shown()).toBeNull();
    await tick();
    expect(first.value).toBe(false);
    expect(second.value).toBe('pending');
    expect(shown()).toEqual({ mode: 'confirm', message: '第二问' });
  });

  it('发起时已经 abort：不弹、不排队，按取消结算', async () => {
    const stopped = new AbortController();
    stopped.abort();

    expect(await dialog.openChoice({ message: 'SITE A', choices: GENERATE, signal: stopped.signal })).toBeNull();
    expect(await dialog.open({ message: '第一问', signal: stopped.signal })).toBe(false);
    expect(shown()).toBeNull();
  });

  it('答过的请求事后再 abort，不影响后面正弹着的', async () => {
    const stopped = new AbortController();
    const first = track(dialog.open({ message: '第一问', signal: stopped.signal }));
    const second = track(dialog.open({ message: '第二问' }));
    dialog.closeConfirm(true);
    await tick();

    stopped.abort();
    await tick();
    expect(first.value).toBe(true);
    expect(second.value).toBe('pending');
    expect(shown()).toEqual({ mode: 'confirm', message: '第二问' });
  });

  it('skipWhen：轮到它、弹出来之前问一次——回 true 就不弹、按取消结算，直接弹再下一个；还在排队的时候不问', async () => {
    const hidden = vi.fn(() => true);
    const first = track(dialog.open({ message: '第一问' }));
    const second = track(dialog.openChoice({ message: 'SITE B', choices: GENERATE, skipWhen: hidden }));
    const third = track(dialog.open({ message: '第三问' }));
    expect(hidden).not.toHaveBeenCalled();

    dialog.closeConfirm(true);
    await tick();
    expect(first.value).toBe(true);
    expect(hidden).toHaveBeenCalledTimes(1);
    expect(second.value).toBeNull();
    expect(third.value).toBe('pending');
    expect(shown()).toEqual({ mode: 'confirm', message: '第三问' });
  });

  it('skipWhen 回 false 照常弹；前面没有别人、当场就轮到的也在弹之前问', async () => {
    const shownStill = vi.fn(() => false);
    const asked = dialog.open({ message: '照常问', skipWhen: shownStill });
    expect(shownStill).toHaveBeenCalledTimes(1);
    expect(shown()).toEqual({ mode: 'confirm', message: '照常问' });
    dialog.closeConfirm(true);
    expect(await asked).toBe(true);

    const skipped = dialog.open({ message: '不用问', skipWhen: () => true });
    expect(shown()).toBeNull();
    expect(await skipped).toBe(false);
  });

  it('skipWhen 抛错：照常问人，不把这一问吞掉，也不卡住后面的', async () => {
    const first = track(dialog.open({ message: '第一问', skipWhen: () => { throw new Error('boom'); } }));
    const second = track(dialog.open({ message: '第二问' }));
    expect(shown()).toEqual({ mode: 'confirm', message: '第一问' });

    dialog.closeConfirm(true);
    await tick();
    expect(first.value).toBe(true);
    expect(second.value).toBe('pending');
    expect(shown()).toEqual({ mode: 'confirm', message: '第二问' });
  });

  it('skipWhen 里顺手叫停了加载（signal 跟着 abort）：这一问只结算一次，后面的照常弹', async () => {
    const stopped = new AbortController();
    const answers: (string | null)[] = [];
    void dialog.open({ message: '第一问' });
    void dialog.openChoice({
      message: 'SITE B',
      choices: GENERATE,
      signal: stopped.signal,
      skipWhen: () => {
        stopped.abort();
        return stopped.signal.aborted;
      },
    }).then((answer) => { answers.push(answer); });
    const third = track(dialog.open({ message: '第三问' }));

    dialog.closeConfirm(true);
    await tick();
    expect(answers).toEqual([null]);
    expect(third.value).toBe('pending');
    expect(shown()).toEqual({ mode: 'confirm', message: '第三问' });
  });
});
