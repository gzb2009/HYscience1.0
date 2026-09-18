/** End timestamp for the thinking-duration clock. */
export function turnClockEnd(input: {
  created: number
  now: number
  live: boolean
  completed?: number
  paused?: number
  lastActivity?: number
}) {
  if (input.completed) return input.completed
  if (input.paused) return input.paused
  if (input.live) return input.now
  return input.lastActivity ?? input.created
}

export function partStamp(part: { time?: { start?: number; end?: number } } | object | undefined) {
  const time = part && "time" in part ? (part as { time?: { start?: number; end?: number } }).time : undefined
  if (!time) return 0
  return Math.max(time.end ?? 0, time.start ?? 0)
}
