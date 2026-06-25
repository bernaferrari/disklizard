/**
 * Tiny spring engine — frame-rate-independent, never overshoots, zero deps.
 *
 * Uses the classic "smooth damp" (critically-damped) integrator so values arrive
 * gracefully regardless of refresh rate. A single shared rAF loop ticks every
 * active spring; dormant springs detach to keep the loop empty at rest.
 *
 * Usage:
 *   const width = createSpring(0, 0.22)
 *   width.set(0.8)           // animate toward 0.8
 *   <div style={{ width: `${width() * 100}%` }} />
 */

import { createSignal, onCleanup } from "solid-js"

export type Spring = {
  /** Current value accessor — reactive, drives style props each frame. */
  (): number
  /** Animate toward a new target. */
  set(target: number): void
  /** Jump instantly (no animation). */
  jump(value: number): void
  /** Current target. */
  target(): number
}

type ActiveSpring = {
  pos: number
  vel: number
  target: number
  smooth: number
  signal: (v: number) => void
}

const EPS = 0.0004
let frame: number | null = null
const active: Set<ActiveSpring> = new Set()
let lastT = 0

function smoothDamp(current: number, target: number, velocity: number, smoothTime: number, dt: number) {
  const omega = 2 / Math.max(0.0001, smoothTime)
  const x = omega * dt
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
  const change = current - target
  const temp = (velocity + omega * change) * dt
  const newVel = (velocity - omega * temp) * exp
  const out = target + (change + temp) * exp
  return { value: out, velocity: newVel }
}

function tick(now: number) {
  if (!active.size) {
    frame = null
    lastT = 0
    return
  }
  const dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 0.016
  lastT = now
  const done: ActiveSpring[] = []
  for (const s of active) {
    const r = smoothDamp(s.pos, s.target, s.vel, s.smooth, dt)
    s.pos = r.value
    s.vel = r.velocity
    s.signal(s.pos)
    if (Math.abs(s.pos - s.target) < EPS && Math.abs(s.vel) < EPS) {
      s.pos = s.target
      s.signal(s.pos)
      done.push(s)
    }
  }
  for (const s of done) active.delete(s)
  frame = requestAnimationFrame(tick)
}

function wake() {
  if (frame === null) {
    lastT = 0
    frame = requestAnimationFrame(tick)
  }
}

/** Create a critically-damped spring accessor bound to Solid reactivity. */
export function createSpring(initial = 0, smoothTime = 0.2): Spring {
  const [get, set] = createSignal(initial)
  const state: ActiveSpring = {
    pos: initial,
    vel: 0,
    target: initial,
    smooth: smoothTime,
    signal: set,
  }
  const spring: Spring = () => get()
  spring.set = (target: number) => {
    if (Math.abs(state.target - target) < EPS && active.has(state)) return
    state.target = target
    active.add(state)
    wake()
  }
  spring.jump = (value: number) => {
    state.pos = value
    state.vel = 0
    state.target = value
    active.delete(state)
    set(value)
  }
  spring.target = () => state.target
  onCleanup(() => active.delete(state))
  return spring
}

/**
 * Animate a number from `from` to `to` over `ms`, calling `onUpdate` each frame
 * with an eased value. Returns a cancel function. Great for count-up stats.
 */
export function animateCount(from: number, to: number, ms: number, onUpdate: (v: number) => void) {
  const start = performance.now()
  let raf = 0
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / ms)
    const e = 1 - Math.pow(1 - t, 3)
    onUpdate(from + (to - from) * e)
    if (t < 1) raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
  return () => cancelAnimationFrame(raf)
}

/** Preset smooth times (seconds to "mostly arrive"). */
export const MOTION = {
  snap: 0.14,
  swift: 0.2,
  smooth: 0.28,
  lush: 0.42,
} as const
