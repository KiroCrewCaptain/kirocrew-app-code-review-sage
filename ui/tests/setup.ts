import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { resetStubSdk } from './stubs/app-sdk'

afterEach(() => {
  cleanup()
  resetStubSdk()
})

// jsdom has no EventSource. Nothing in this page opens one; the stand-in keeps a
// stray construction inert.
class InertEventSource {
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: Event) => void) | null = null
  constructor(public url: string) {}
  close(): void {}
}
if (typeof globalThis.EventSource === 'undefined') {
  ;(globalThis as { EventSource?: unknown }).EventSource = InertEventSource
}

// jsdom has no PointerEvent, so `fireEvent.pointerDown(el, { button: 0 })` would
// build a plain Event with no `button`. The dashboard's suites ran on happy-dom,
// which has one; this is the same shape over jsdom's MouseEvent.
if (typeof window.PointerEvent === 'undefined') {
  class PointerEventShim extends MouseEvent {
    readonly pointerId: number
    readonly pointerType: string
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init)
      this.pointerId = init.pointerId ?? 0
      this.pointerType = init.pointerType ?? 'mouse'
    }
  }
  ;(window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventShim
}
