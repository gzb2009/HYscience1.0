export type SessionState = {
  type?: string
}

export function runningSessionCount(
  sessions: ReadonlyArray<{ id: string }>,
  statuses: Readonly<Record<string, SessionState | undefined>>,
): number {
  return sessions.reduce((count, session) => {
    const type = statuses[session.id]?.type
    return type === "busy" || type === "retry" ? count + 1 : count
  }, 0)
}
