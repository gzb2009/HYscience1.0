/**
 * Plugin sandbox — isolates plugin execution in a Bun Worker.
 * Plugins opt-in via `Plugin.meta.sandbox = true`.
 * Workers get 30s timeout + 256MB memory cap.
 */
const TIMEOUT = 30_000
const MEMORY_MB = 256

interface SandboxInput {
  pluginPath: string
  fn: string
  args: unknown[]
}

interface SandboxOutput {
  ok: boolean
  result?: unknown
  error?: string
  duration: number
}

declare var self: Worker

self.onmessage = async (event: MessageEvent<SandboxInput>) => {
  const { pluginPath, fn, args } = event.data
  const start = Date.now()
  try {
    const mod = await import(pluginPath)
    const result = await mod[fn](...args)
    const output: SandboxOutput = {
      ok: true,
      result,
      duration: Date.now() - start,
    }
    self.postMessage(output)
  } catch (err) {
    const output: SandboxOutput = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      duration: Date.now() - start,
    }
    self.postMessage(output)
  }
}
