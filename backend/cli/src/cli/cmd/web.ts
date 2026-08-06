import { Server } from "../../server/server"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import open from "open"
import { openUrl } from "../../util/open-url"
import { needsOnboarding, runOnboarding, isConfigured } from "../onboard"
import fs from "fs/promises"
import os from "os"
import path from "path"

// macOS TCC probe: try to read ~/Desktop, which is one of the canonical
// dirs blocked unless the running binary has Full Disk Access. An empty
// Desktop dir is rare enough that we treat 0-entries OR EACCES/EPERM as
// "FDA missing" — both are actionable signals on the user's end.
async function probeMacFda(): Promise<{ blocked: boolean; reason?: string }> {
  if (process.platform !== "darwin") return { blocked: false }
  const desktop = path.join(os.homedir(), "Desktop")
  try {
    const entries = await fs.readdir(desktop)
    if (entries.length > 0) return { blocked: false }
    return { blocked: true, reason: "hyscience returned 0 entries for ~/Desktop (TCC likely blocking)" }
  } catch (err: any) {
    if (err?.code === "EACCES" || err?.code === "EPERM") {
      return { blocked: true, reason: err.message }
    }
    // ENOENT, etc. — Desktop doesn't exist on this machine; nothing to warn about.
    return { blocked: false }
  }
}

const FDA_SETTINGS_URL = "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"

async function announceFdaIfNeeded() {
  const result = await probeMacFda()
  if (!result.blocked) return
  const binary = process.execPath || "hyscience"
  UI.empty()
  UI.println(UI.Style.TEXT_WARNING_BOLD + "  ⚠  Full Disk Access required", UI.Style.TEXT_NORMAL)
  UI.empty()
  UI.println(UI.Style.TEXT_NORMAL, "  macOS is blocking HYscience from listing ~/Desktop, ~/Documents and ~/Downloads.")
  UI.println(UI.Style.TEXT_NORMAL, "  Without Full Disk Access the folder picker and file tree will be empty.")
  UI.empty()
  UI.println(UI.Style.TEXT_INFO_BOLD + "  Grant access:", UI.Style.TEXT_NORMAL)
  UI.println(UI.Style.TEXT_NORMAL, "    1. The Privacy & Security pane just opened — find “Full Disk Access”")
  UI.println(UI.Style.TEXT_NORMAL, "    2. Click +, hit ⌘⇧G, paste the path below, click Open")
  UI.println(UI.Style.TEXT_NORMAL, "    3. Toggle the hyscience entry on")
  UI.println(UI.Style.TEXT_NORMAL, "    4. Quit (Ctrl+C) and relaunch `hyscience web`")
  UI.empty()
  UI.println(UI.Style.TEXT_INFO_BOLD + "  Path to add:", UI.Style.TEXT_NORMAL, "  " + binary)
  UI.empty()
  // Open System Settings pre-positioned on the FDA pane.
  open(FDA_SETTINGS_URL).catch(() => {})
}

export const WebCommand = cmd({
  // Default command: bare `hyscience` and `hyscience web` both open the
  // workspace in the browser. An optional [project] path runs it in that dir.
  command: ["web", "$0 [project]"],
  builder: (yargs) =>
    withNetworkOptions(yargs).positional("project", {
      type: "string",
      describe: "directory to open the workspace in",
    }),
  describe: "open the HYscience workspace in your browser",
  handler: async (args) => {
    if (args.project) {
      try {
        process.chdir(args.project as string)
      } catch {
        UI.error(`Cannot open ${args.project}: no such directory`)
        process.exit(1)
      }
    }
    const opts = await resolveNetworkOptions(args)
    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()

    // First launch on this machine with nothing configured → walk the user
    // through setup (managed vs BYOK vs skip) before we bind the server, so
    // the browser's first request already sees a usable model.
    if (await needsOnboarding()) {
      await runOnboarding()
      UI.empty()
    }

    // Warn early when no provider keys are configured.
    if (!(await isConfigured())) {
      UI.println(UI.Style.TEXT_WARNING_BOLD + "  ⚠  No model configured", UI.Style.TEXT_NORMAL)
      UI.println(UI.Style.TEXT_NORMAL, "  Run `hyscience keys add` to connect a provider API key.")
      UI.println(UI.Style.TEXT_DIM, "  Continuing without a default model until you configure one.")
      UI.empty()
    }

    const server = Server.listen(opts)

    const base = `http://localhost:${server.port}`
    UI.println(UI.Style.TEXT_INFO_BOLD + "  Web interface:    ", UI.Style.TEXT_NORMAL, base)
    UI.empty()
    UI.println(UI.Style.TEXT_DIM, "  Opening your browser… if it doesn't open, visit the URL above.")

    openUrl(base)

    // macOS-only: warn the user (and pop System Settings) if Full Disk
    // Access is missing — without it the folder picker and file tree silently
    // return empty for ~/Desktop, ~/Documents, ~/Downloads.
    await announceFdaIfNeeded()

    // Wait for a termination signal. Without an explicit handler Bun keeps
    // the process alive (the catch-all promise never resolves) and Ctrl+C
    // is ignored.
    await new Promise<void>((resolve) => {
      const stop = () => resolve()
      process.once("SIGINT", stop)
      process.once("SIGTERM", stop)
    })
    // Hard-exit on Ctrl+C. Force-close active connections first, but never let
    // a stalled server.stop() (long-lived `/event` SSE streams) or an in-flight
    // background config sync (a pending fetch keeps Bun's loop alive) block the
    // exit — a watchdog forces it, and process.exit ignores dangling sockets.
    const watchdog = setTimeout(() => process.exit(0), 2000)
    watchdog.unref?.()
    try {
      await server.stop(true)
    } catch {
      // ignore — exiting regardless
    }
    process.exit(0)
  },
})
