export type MbdPipeAnnotationRequestLike = {
  refno: string
  timestamp: number
}

export function createLatestOnlyGate() {
  let currentSeq = 0
  return {
    issue(): number {
      currentSeq += 1
      return currentSeq
    },
    isLatest(seq: number): boolean {
      return seq === currentSeq
    },
  }
}

export function shouldClearMbdRequest(
  current: MbdPipeAnnotationRequestLike | null,
  handled: MbdPipeAnnotationRequestLike
): boolean {
  if (!current) return false
  return current.refno === handled.refno && current.timestamp === handled.timestamp
}

export class ExternalAnnotationRegistry {
  private readonly ids = new Set<string>()

  sync(
    nextIds: Iterable<string>,
    register: (id: string) => void,
    unregister: (id: string) => void
  ): void {
    const next = new Set(nextIds)
    for (const id of this.ids) {
      if (!next.has(id)) {
        unregister(id)
        this.ids.delete(id)
      }
    }
    for (const id of next) {
      if (this.ids.has(id)) continue
      register(id)
      this.ids.add(id)
    }
  }

  clear(unregister: (id: string) => void): void {
    for (const id of this.ids) {
      unregister(id)
    }
    this.ids.clear()
  }

  values(): Set<string> {
    return new Set(this.ids)
  }
}
