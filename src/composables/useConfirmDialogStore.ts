import { ref } from 'vue'

export type ConfirmDialogOptions = {
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
}

const visible = ref(false)
const title = ref<string>('')
const message = ref<string>('')
const confirmText = ref<string>('确认')
const cancelText = ref<string>('取消')

let resolver: ((v: boolean) => void) | null = null

export function useConfirmDialogStore() {
  function open(options: ConfirmDialogOptions): Promise<boolean> {
    title.value = options.title ?? '提示'
    message.value = options.message
    confirmText.value = options.confirmText ?? '确认'
    cancelText.value = options.cancelText ?? '取消'
    visible.value = true

    return new Promise<boolean>((resolve) => {
      resolver = resolve
    })
  }

  function close(result: boolean) {
    visible.value = false
    const r = resolver
    resolver = null
    r?.(result)
  }

  return {
    visible,
    title,
    message,
    confirmText,
    cancelText,
    open,
    close,
  }
}

