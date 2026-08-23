/**
 * Bounds both metadata I/O and recursive traversal while keeping cancellation
 * observable to work that is waiting for a permit.
 */
export class ScanScheduler {
  private active = 0
  private queue: Array<{ start: () => boolean; abort: () => void }> = []
  private queueHead = 0

  constructor(
    private readonly limit: number,
    private readonly signal?: AbortSignal,
  ) {
    signal?.addEventListener(
      "abort",
      () => {
        for (let index = this.queueHead; index < this.queue.length; index++) this.queue[index].abort()
        this.queue = []
        this.queueHead = 0
      },
      { once: true },
    )
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    this.signal?.throwIfAborted()
    if (this.active >= this.limit) {
      await new Promise<void>((resolve, reject) => {
        let waiting = true
        this.queue.push({
          start: () => {
            if (!waiting) return false
            waiting = false
            resolve()
            return true
          },
          abort: () => {
            if (!waiting) return
            waiting = false
            reject(this.signal?.reason ?? new Error("Scan cancelled"))
          },
        })
      })
    }
    this.signal?.throwIfAborted()
    this.active++
    try {
      return await operation()
    } finally {
      this.active--
      let started = false
      while (!started && this.queueHead < this.queue.length) started = this.queue[this.queueHead++].start()
      // Array.shift() moves every queued syscall on every completion. Compact
      // occasionally while keeping dequeue O(1) in the common case.
      if (this.queueHead === this.queue.length) {
        this.queue = []
        this.queueHead = 0
      } else if (this.queueHead > 4096 && this.queueHead * 2 > this.queue.length) {
        this.queue = this.queue.slice(this.queueHead)
        this.queueHead = 0
      }
    }
  }

  async forEach<T>(items: readonly T[], operation: (item: T) => Promise<void>): Promise<void> {
    for (let offset = 0; offset < items.length; offset += this.limit) {
      this.signal?.throwIfAborted()
      const end = Math.min(items.length, offset + this.limit)
      const batch: Promise<void>[] = []
      for (let index = offset; index < end; index++) batch.push(operation(items[index]))
      await Promise.all(batch)
    }
  }
}
