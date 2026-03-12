import { ref } from 'vue';

export type ConfirmDialogOptions = {
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

export type ChoiceDialogOptions = {
  title?: string
  message: string
  choices: ChoiceDialogItem[]
  cancelText?: string
}

type DialogMode = 'confirm' | 'choice'

const visible = ref(false);
const title = ref<string>('');
const message = ref<string>('');
const confirmText = ref<string>('确认');
const cancelText = ref<string>('取消');

const mode = ref<DialogMode>('confirm');
const choices = ref<ChoiceDialogItem[]>([]);

let confirmResolver: ((v: boolean) => void) | null = null;
let choiceResolver: ((v: string | null) => void) | null = null;

export function useConfirmDialogStore() {
  function open(options: ConfirmDialogOptions): Promise<boolean> {
    mode.value = 'confirm';
    title.value = options.title ?? '提示';
    message.value = options.message;
    confirmText.value = options.confirmText ?? '确认';
    cancelText.value = options.cancelText ?? '取消';
    choices.value = [];
    visible.value = true;

    return new Promise<boolean>((resolve) => {
      confirmResolver = resolve;
    });
  }

  function openChoice(options: ChoiceDialogOptions): Promise<string | null> {
    mode.value = 'choice';
    title.value = options.title ?? '提示';
    message.value = options.message;
    cancelText.value = options.cancelText ?? '取消';
    choices.value = options.choices;
    visible.value = true;

    return new Promise<string | null>((resolve) => {
      choiceResolver = resolve;
    });
  }

  function closeConfirm(result: boolean) {
    visible.value = false;
    const r = confirmResolver;
    confirmResolver = null;
    r?.(result);
  }

  function choose(id: string) {
    visible.value = false;
    const r = choiceResolver;
    choiceResolver = null;
    r?.(id);
  }

  function cancelChoice() {
    visible.value = false;
    const r = choiceResolver;
    choiceResolver = null;
    r?.(null);
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
