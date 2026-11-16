/**
 * 全局确认弹窗的状态。全页面只有一个弹窗（`components/ui/ConfirmDialog.vue`），请求按发起的先后排队，一次弹一个：
 * 每个请求有自己的 Promise，点按钮、按 Esc、点弹窗外面结算的都只是正弹着的那一个，然后弹下一个。
 *
 * 原来只有一个回调槽位：前一个还没答，后一个请求就把它的回调盖掉了，前一个永远等不到答复——连续点亮几个要确认生成的
 * SITE 时只有最后一个能往下走，其余的一直转圈（#163）。
 */
import { nextTick, ref, watch } from 'vue';

/** 排队期间发起方那边的情况可能变了（加载被叫停、节点被隐藏）：让这一问不再打扰人的两个办法 */
export type DialogQueueOptions = {
  /**
   * 发起方不需要这一问了就 abort：还在排队的当场出队，正弹着的关掉，发起时已经 abort 的不弹。
   * 都按取消结算（`open` 得 `false`，`openChoice` 得 `null`）。
   */
  signal?: AbortSignal
  /** 轮到这一问、弹出来之前问一次：回 `true` 就不弹，按取消结算。给没有信号可认的情形（节点在排队期间被隐藏了） */
  skipWhen?: () => boolean
}

export type ConfirmDialogOptions = DialogQueueOptions & {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
}

export type ChoiceDialogItem = {
  id: string
  text: string
  color?: string
  variant?: 'text' | 'flat' | 'tonal'
}

export type ChoiceDialogOptions = DialogQueueOptions & {
  title?: string
  message: string
  choices: ChoiceDialogItem[]
  cancelText?: string
}

type DialogMode = 'confirm' | 'choice'

/** 一次答复：确认框只看 `confirmed`，选择框只看 `choice` */
type DialogAnswer = { confirmed: boolean; choice: string | null }

type DialogRequest = {
  /** 把这一问的内容放到弹窗上 */
  show: () => void
  resolve: (answer: DialogAnswer) => void
  skipWhen?: () => boolean
  /** 摘掉挂在发起方 `signal` 上的监听 */
  detach: () => void
  /** 已经结算过（答复、取消、跳过只算第一次） */
  settled: boolean
}

const CANCELLED: DialogAnswer = { confirmed: false, choice: null };

const visible = ref(false);
const title = ref<string>('');
const message = ref<string>('');
const confirmText = ref<string>('确认');
const cancelText = ref<string>('取消');

const mode = ref<DialogMode>('confirm');
const choices = ref<ChoiceDialogItem[]>([]);

/** 排着队、还没弹出来的（先发起的在前） */
const queue: DialogRequest[] = [];
/** 正弹着的那一个 */
let current: DialogRequest | null = null;
/** 刚关掉一个，下一个定在下一拍弹 */
let presentScheduled = false;

function wantsSkip(request: DialogRequest): boolean {
  if (!request.skipWhen) return false;
  try {
    return request.skipWhen() === true;
  } catch {
    // 判断出错就照常问人：不能把这一问悄悄吞掉
    return false;
  }
}

function settle(request: DialogRequest, answer: DialogAnswer): void {
  if (request.settled) return;
  request.settled = true;
  request.detach();
  const queuedAt = queue.indexOf(request);
  if (queuedAt >= 0) queue.splice(queuedAt, 1);
  if (current === request) {
    // 先清 `current` 再关：盯着 `visible` 的那个 watch 是同步的，见 `current` 已空就知道这一关不是人关的
    current = null;
    visible.value = false;
    // 下一个等这一下「关」更新到界面之后再弹（Vue 的下一拍）：同一拍里关了又开，两次改动会被并成没变，界面上只是字换了；
    // 隔一拍，弹窗组件看到的是真的关了再开
    if (!presentScheduled) {
      presentScheduled = true;
      void nextTick(presentNext);
    }
  }
  request.resolve(answer);
}

/** 弹出队首的请求；轮到时已经不用问的直接按取消结算、看下一个 */
function presentNext(): void {
  presentScheduled = false;
  while (!current && queue.length > 0) {
    const request = queue[0]!;
    if (wantsSkip(request)) settle(request, CANCELLED);
    // `skipWhen` 里也可能已经把它结算了（它叫停了加载 → `signal` abort）
    if (request.settled) continue;
    queue.shift();
    current = request;
    request.show();
    visible.value = true;
  }
}

function submit(options: DialogQueueOptions, show: () => void, resolve: (answer: DialogAnswer) => void): void {
  const { signal, skipWhen } = options;
  if (signal?.aborted) {
    resolve(CANCELLED);
    return;
  }
  const request: DialogRequest = { show, resolve, skipWhen, detach: () => {}, settled: false };
  if (signal) {
    const onAbort = () => settle(request, CANCELLED);
    signal.addEventListener('abort', onAbort, { once: true });
    request.detach = () => signal.removeEventListener('abort', onAbort);
  }
  queue.push(request);
  // 前面没有别的请求就当场弹出来；刚关掉一个、下一个还没弹的那一拍里照样排着
  if (!current && !presentScheduled) presentNext();
}

/** 结算正弹着的那一个（没有在弹的也把弹窗关上） */
function answerCurrent(answer: DialogAnswer): void {
  if (current) settle(current, answer);
  else visible.value = false;
}

// 弹窗被人直接关掉（按 Esc、点弹窗外面：`v-dialog` 直接把 `visible` 写成 false，不经 `closeConfirm` / `cancelChoice`）：
// 按取消结算正弹着的那一个——不然它永远等不到答复，排在后面的也永远弹不出来。
watch(visible, (shown) => {
  if (!shown && current) settle(current, CANCELLED);
}, { flush: 'sync' });

export function useConfirmDialogStore() {
  function open(options: ConfirmDialogOptions): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      submit(options, () => {
        mode.value = 'confirm';
        title.value = options.title ?? '提示';
        message.value = options.message;
        confirmText.value = options.confirmText ?? '确认';
        cancelText.value = options.cancelText ?? '取消';
        choices.value = [];
      }, (answer) => resolve(answer.confirmed));
    });
  }

  function openChoice(options: ChoiceDialogOptions): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      submit(options, () => {
        mode.value = 'choice';
        title.value = options.title ?? '提示';
        message.value = options.message;
        cancelText.value = options.cancelText ?? '取消';
        choices.value = options.choices;
      }, (answer) => resolve(answer.choice));
    });
  }

  function closeConfirm(result: boolean) {
    answerCurrent({ confirmed: result, choice: null });
  }

  function choose(id: string) {
    answerCurrent({ confirmed: false, choice: id });
  }

  function cancelChoice() {
    answerCurrent(CANCELLED);
  }

  return {
    visible,
    title,
    message,
    confirmText,
    cancelText,
    open,
    mode,
    choices,
    openChoice,
    closeConfirm,
    choose,
    cancelChoice,
  };
}

export function __resetConfirmDialogStoreForTests(): void {
  for (const request of [...queue]) settle(request, CANCELLED);
  if (current) settle(current, CANCELLED);
  presentScheduled = false;
}
