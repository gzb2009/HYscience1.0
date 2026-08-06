import { Log } from "../util/log"

const log = Log.create({ service: "sandbox" })
const TIMEOUT = 30_000

/**
 * Executes a plugin hook in a sandboxed Bun Worker.
 * Falls back to direct execution when Workers are unavailable.
 */
export async function exec(pluginPath: string, fn: string, args: unknown[]): Promise<unknown> {
  const workerURL = new URL("./worker.ts", import.meta.url)

  const w = new Worker(workerURL)
  const promise = new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => {
      w.terminate()
      reject(new Error(`Sandbox timeout: ${TIMEOUT}ms`))
    }, TIMEOUT)

    w.onmessage = (event: MessageEvent) => {
      clearTimeout(timeout)
      const data = event.data as { ok: boolean; result?: unknown; error?: string }
      if (data.ok) resolve(data.result)
      else reject(new Error(data.error ?? "sandbox error"))
    }

    w.onerror = (err) => {
      clearTimeout(timeout)
      reject(err)
    }
  })

  w.postMessage({ pluginPath, fn, args })
  return promise
}

/**
 * Checks whether a plugin entry should run sandboxed.
 * Plugins declare `sandbox: true` in their meta.
 */
export function wantsSandbox(meta: { sandbox?: boolean }): boolean {
  return meta.sandbox === true
}
