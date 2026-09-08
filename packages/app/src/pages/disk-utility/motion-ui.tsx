import * as React from "react"
import { motion, MotionConfig, type HTMLMotionProps } from "framer-motion"

/**
 * framer-motion replacements for v1's CSS keyframes. Components animate with
 * `motion` instead of `dl-spin`/`dl-pulse`/… classes, honoring
 * prefers-reduced-motion through framer's global config.
 */

export const DISK_MOTION_EASE = [0.32, 0.72, 0, 1] as const

/** Continuous rotation (v1 `dl-spin`, `dl-scan-sweep`). */
export function Spin({ duration = 0.8, origin, ...rest }: { duration?: number; origin?: string } & HTMLMotionProps<"div">) {
  return (
    <motion.div
      animate={{ rotate: 360 }}
      transition={{ duration, ease: "linear", repeat: Infinity }}
      style={origin ? { transformOrigin: origin } : undefined}
      {...rest}
    />
  )
}

/** Soft breathing emphasis (v1 `dl-pulse`). */
export function Pulse(props: HTMLMotionProps<"div">) {
  return (
    <motion.div
      animate={{ scale: [1, 1.12, 1], opacity: [0.9, 1, 0.9] }}
      transition={{ duration: 1.4, ease: "easeInOut", repeat: Infinity }}
      {...props}
    />
  )
}

/** Opacity beacon for live scan activity (v1 `dl-scan-beacon`). */
export function Beacon(props: HTMLMotionProps<"div">) {
  return (
    <motion.div
      animate={{ opacity: [0.42, 1, 0.42] }}
      transition={{ duration: 1.1, ease: "easeInOut", repeat: Infinity }}
      {...props}
    />
  )
}

/** Enter-once pop used by inline surfaces (v1 `dl-pop`). */
export function PopIn(props: HTMLMotionProps<"div">) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, y: 4 }}
      transition={{ duration: 0.24, ease: DISK_MOTION_EASE }}
      {...props}
    />
  )
}

/** Enter-once fade + settle for images (v1 `dl-preview-arrive`). */
export function FadeSettle(props: HTMLMotionProps<"img">) {
  return (
    <motion.img
      initial={{ opacity: 0, scale: 0.985 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.18, ease: DISK_MOTION_EASE }}
      {...props}
    />
  )
}

/** Provider wiring reduced-motion preference into framer globally. */
export function DiskMotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>
}
