#!/usr/bin/env node

// `npx hysci`: the HYscience install wizard.
//
// The npm package (and this bin) keep the historical `hysci` name so the
// one-liner everyone knows keeps working; everything it installs is the
// HYscience CLI (`@hysci/hyscience`, binary `hyscience`), optionally with the
// HYscience Cloud managed platform on top.

// Hard guard against recursive invocation. If a check ever resolves to the
// launcher itself, this prevents an infinite spawn chain that exhausts memory.
if (process.env.__HYSCI_LAUNCHER_PID) {
  process.stderr.write(
    `hysci: launcher invoked recursively (parent pid ${process.env.__HYSCI_LAUNCHER_PID}). Exiting.\n`,
  )
  process.exit(2)
}
process.env.__HYSCI_LAUNCHER_PID = String(process.pid)

import { execFileSync, execSync, spawn } from "node:child_process"
import { existsSync, readFileSync, realpathSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"

const SELF_PATH = (() => {
  try {
    return realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return ""
  }
})()

const BOLD = "\x1b[1m"
const DIM = "\x1b[2m"
const CYAN = "\x1b[36m"
const GREEN = "\x1b[32m"
const YELLOW = "\x1b[33m"
const RED = "\x1b[31m"
const RESET = "\x1b[0m"
const HIDE_CURSOR = "\x1b[?25l"
const SHOW_CURSOR = "\x1b[?25h"
const CLEAR_LINE = "\x1b[2K\r"

const LOGO = [
  "██╗  ██╗██╗   ██╗███████╗ ██████╗██╗███████╗███╗   ██╗ ██████╗███████╗",
  "██║  ██║╚██╗ ██╔╝██╔════╝██╔════╝██║██╔════╝████╗  ██║██╔════╝██╔════╝",
  "███████║ ╚████╔╝ ███████╗██║     ██║█████╗  ██╔██╗ ██║██║     █████╗  ",
  "██╔══██║  ╚██╔╝  ╚════██║██║     ██║██╔══╝  ██║╚██╗██║██║     ██╔══╝  ",
  "██║  ██║   ██║   ███████║╚██████╗██║███████╗██║ ╚████║╚██████╗███████╗",
  "╚═╝  ╚═╝   ╚═╝   ╚══════╝ ╚═════╝╚═╝╚══════╝╚═╝  ╚═══╝ ╚═════╝╚══════╝",
]

function ok(msg) {
  console.log(`  ${GREEN}✓${RESET} ${msg}`)
}
function warn(msg) {
  console.log(`  ${YELLOW}⚠${RESET} ${msg}`)
}

function spinner(msg) {
  const frames = ["◒", "◐", "◓", "◑"]
  let i = 0
  process.stdout.write(HIDE_CURSOR)
  const id = setInterval(() => {
    process.stdout.write(`${CLEAR_LINE}  ${CYAN}${frames[i++ % frames.length]}${RESET} ${msg}`)
  }, 80)
  return {
    ok(result) {
      clearInterval(id)
      process.stdout.write(`${CLEAR_LINE}${SHOW_CURSOR}`)
      ok(result)
    },
    warn(result) {
      clearInterval(id)
      process.stdout.write(`${CLEAR_LINE}${SHOW_CURSOR}`)
      warn(result)
    },
    fail(result) {
      clearInterval(id)
      process.stdout.write(`${CLEAR_LINE}${SHOW_CURSOR}`)
      console.log(`  ${RED}✗${RESET} ${result}`)
    },
    update(m) {
      msg = m
    },
  }
}

function runQuiet(cmd) {
  try {
    return execSync(cmd, { encoding: "utf-8", stdio: "pipe" }).trim()
  } catch {
    return null
  }
}

// Windows global installs expose a .cmd shim, which can't be exec'd
// directly — it needs a shell (and the path quoted for it).
const isCmdShim = (p) => process.platform === "win32" && p.toLowerCase().endsWith(".cmd")

function execCli(file, args = [], opts = {}) {
  if (isCmdShim(file)) return execSync(['"' + file + '"', ...args].join(" "), opts)
  return execFileSync(file, args, opts)
}

function runFileQuiet(file, args = []) {
  try {
    return execCli(file, args, { encoding: "utf-8", stdio: "pipe" }).trim()
  } catch {
    return null
  }
}

function isLauncherPath(p) {
  try {
    const real = realpathSync(p)
    if (SELF_PATH && real === SELF_PATH) return true
    if (real.includes("/_npx/")) return true
    return false
  } catch {
    return false
  }
}

// Returns the absolute path to the real @hysci/hyscience binary (`hyscience`).
// Only trusts canonical install locations (no `$PATH` walk) to avoid picking
// up dev shims or workspace symlinks. Each candidate is verified by invoking
// `--version` so half-broken installs are skipped instead of accepted.
function resolveCli() {
  const candidates = []
  // 1. Global npm prefix (where `npm i -g @hysci/hyscience` puts it).
  // On Windows the global bin dir is the prefix itself and the entry is an
  // hyscience.cmd shim; on POSIX it's <prefix>/bin/hyscience.
  const prefix = runQuiet("npm prefix -g")
  if (prefix) {
    if (process.platform === "win32") candidates.push(join(prefix, "hyscience.cmd"))
    else candidates.push(join(prefix, "bin", "hyscience"))
  }
  // 2. ~/.hyscience/bin/hyscience (curl-installer location, POSIX only)
  if (process.platform !== "win32") candidates.push(join(homedir(), ".hyscience", "bin", "hyscience"))

  for (const cand of candidates) {
    if (!existsSync(cand) || isLauncherPath(cand)) continue
    try {
      const ver = execCli(cand, ["--version"], {
        encoding: "utf-8",
        stdio: "pipe",
        timeout: 5000,
      }).trim()
      if (/^\d/.test(ver)) return cand
    } catch {
      /* unrunnable candidate, try next */
    }
  }
  return null
}

// The deprecated `@hysci/cli` package links the same `hyscience` bin. npm
// refuses to overwrite a bin file owned by another package (EEXIST), so a
// stale global install dead-ends the upgrade — and its old binary shadows the
// real one on PATH. `npm ls` exits nonzero when the package is absent but
// still prints JSON, so read stdout either way.
function hasDeprecatedCli() {
  let out = ""
  try {
    out = execSync("npm ls -g @hysci/cli --depth=0 --json", { encoding: "utf-8", stdio: "pipe" })
  } catch (e) {
    out = e && typeof e.stdout === "string" ? e.stdout : ""
  }
  try {
    return Boolean(JSON.parse(out).dependencies["@hysci/cli"])
  } catch {
    return false
  }
}

function isConnected() {
  const xdgData = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share")
  const sessionPath = join(xdgData, "hyscience", "hyscience-session.json")
  if (!existsSync(sessionPath)) return false
  try {
    const data = JSON.parse(readFileSync(sessionPath, "utf-8"))
    if (!data.access_token || !data.expires_at) return false
    return new Date(data.expires_at) > new Date()
  } catch {
    return false
  }
}

function graphCliVersion() {
  const raw = runQuiet("hysci-graph --version")
  return raw ? raw.replace(/[^0-9.]/g, "") : null
}

async function ensureGraphCli() {
  const current = graphCliVersion()
  if (current) {
    ok(`hysci-graph ${current} ${DIM}(available)${RESET}`)
    return true
  }
  warn(`hysci-graph not on PATH — it ships with @hysci/hyscience (research graph CLI)`)
  return false
}

async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

async function main() {
  process.on("exit", () => process.stdout.write(SHOW_CURSOR))
  process.on("SIGINT", () => {
    process.stdout.write(SHOW_CURSOR)
    process.exit(130)
  })

  // --- Logo ---
  console.log()
  for (const line of LOGO) console.log(`   ${CYAN}${line}${RESET}`)
  console.log()
  console.log(
    `   ${BOLD}HYscience${RESET} ${DIM}HYscience, the open-source AI research workspace · HYscience Cloud, the research platform${RESET}`,
  )
  console.log()

  // --- Step 1: Install or upgrade the HYscience CLI ---
  if (hasDeprecatedCli()) {
    const s = spinner("Removing the deprecated @hysci/cli so it can't shadow the hyscience command...")
    if (runQuiet("npm rm -g @hysci/cli") !== null) {
      s.ok("Removed the deprecated @hysci/cli")
    } else {
      s.warn(`Couldn't remove the deprecated @hysci/cli — if install fails, run: ${CYAN}npm rm -g @hysci/cli${RESET}`)
    }
  }

  let cliPath = resolveCli()
  if (cliPath) {
    const raw = runFileQuiet(cliPath, ["--version"]) || "unknown"
    const isDev = raw === "local" || raw.includes("-")
    if (isDev) {
      ok(`hyscience ${DIM}(dev build)${RESET}`)
    } else {
      const s = spinner("Checking for updates...")
      const current = raw.replace(/[^0-9.]/g, "")
      const latest = runQuiet("npm view @hysci/hyscience version")
      if (!latest || current === latest) {
        s.ok(`hyscience ${current} ${DIM}(up to date)${RESET}`)
      } else {
        s.update(`Upgrading ${current} → ${latest}...`)
        try {
          execCli(cliPath, ["upgrade"], { stdio: "pipe" })
          s.ok(`Upgraded to ${latest}`)
        } catch {
          s.warn(`Upgrade failed, continuing with ${current}`)
        }
      }
    }
  } else {
    const s = spinner("Installing HYscience...")
    try {
      try {
        execSync("npm i -g @hysci/hyscience@latest", { stdio: "pipe" })
      } catch (e) {
        // npm refuses to overwrite a bin file owned by another package
        // (EEXIST). If the conflict is the deprecated @hysci/cli, remove it
        // and retry once before falling back to the standalone installer.
        const stderr = e && e.stderr ? String(e.stderr) : ""
        const conflict = stderr.includes("EEXIST") && (stderr.includes("@hysci/cli") || hasDeprecatedCli())
        if (!conflict) throw e
        s.update("Removing the deprecated @hysci/cli so it can't shadow the hyscience command...")
        runQuiet("npm rm -g @hysci/cli")
        s.update("Retrying the HYscience install...")
        execSync("npm i -g @hysci/hyscience@latest", { stdio: "pipe" })
      }
      cliPath = resolveCli()
      if (!cliPath) throw new Error("hyscience not on PATH after install")
      s.ok("Installed HYscience")
    } catch {
      // The standalone installer is a bash script; on native Windows there's
      // no bash to pipe it into, so don't suggest a fallback that can't run.
      if (process.platform === "win32") {
        s.fail("Install failed")
        console.log(`\n  Try manually: ${CYAN}npm i -g @hysci/hyscience${RESET}\n`)
        process.exit(1)
      }
      // Global npm installs commonly fail on permissions. Fall back to the
      // standalone installer, which lands in ~/.hyscience/bin without sudo
      // (resolveCli already checks that location).
      s.update("npm -g failed, trying the standalone installer...")
      try {
        execSync("curl -fsSL https://hyscience.sh/install | bash", { stdio: "pipe" })
        cliPath = resolveCli()
        if (!cliPath) throw new Error("hyscience not found after install")
        s.ok("Installed HYscience")
      } catch (e2) {
        s.fail(`Install failed${e2 && e2.message ? ": " + e2.message : ""}`)
        console.log(`\n  Try manually: ${CYAN}npm i -g @hysci/hyscience${RESET}`)
        console.log(`  or:           ${CYAN}curl -fsSL https://hyscience.sh/install | bash${RESET}\n`)
        process.exit(1)
      }
    }
  }

  // --- Step 2: Choose a setup ---
  console.log()
  console.log(`  ${BOLD}How do you want to run it?${RESET}`)
  console.log()
  console.log(
    `    ${BOLD}1${RESET}  ${CYAN}HYscience${RESET}         ${DIM}free and open source, bring your own API keys, no account${RESET}`,
  )
  console.log(
    `    ${BOLD}2${RESET}  ${CYAN}HYscience + Atlas${RESET} ${DIM}managed models, wallet billing, research graph & compute${RESET}`,
  )
  console.log(
    `    ${BOLD}3${RESET}  ${CYAN}HYscience Graph CLI${RESET}           ${DIM}just the HYscience Cloud research CLI — maps, runs, and compute from the terminal${RESET}`,
  )
  console.log()

  const setup = await ask(`  ${DIM}❯${RESET} Choose [1/2/3]: `)
  console.log()

  if (setup === "3") {
    // Atlas-CLI-only path: install/upgrade, verify, hand off to `hysci-graph`.
    // No workspace launch — this option exists for people who want the
    // research CLI on a box without opening the browser app.
    const installed = await ensureGraphCli()
    if (!installed) process.exit(1)
    const s = spinner("Running atlas doctor...")
    if (runQuiet("atlas doctor") !== null) {
      s.ok("atlas doctor passed")
    } else {
      s.warn(`atlas doctor reported issues — run ${CYAN}atlas doctor${RESET} for details`)
    }
    if (isConnected()) {
      ok("Connected to Atlas")
    } else {
      console.log()
      console.log(
        `  ${DIM}Connect your HYscience Cloud account for managed credentials:${RESET} ${CYAN}hyscience connect login${RESET}`,
      )
    }
    console.log()
    console.log(`  ${BOLD}Next steps${RESET}`)
    console.log(`    ${CYAN}atlas --help${RESET}   ${DIM}see everything the CLI can do${RESET}`)
    console.log(`    ${CYAN}atlas doctor${RESET}   ${DIM}check credentials and environment${RESET}`)
    console.log()
    process.exit(0)
  }

  if (setup === "2") {
    await ensureGraphCli()
    if (isConnected()) {
      ok("Connected to Atlas")
    } else {
      console.log()
      try {
        execCli(cliPath, ["connect", "login"], { stdio: "inherit" })
      } catch {}
    }
  } else {
    ok(`BYOK mode ${DIM}add provider keys inside the app (or via env vars like ANTHROPIC_API_KEY)${RESET}`)
  }

  console.log()

  // --- Step 3: Launch the workspace ---
  console.log(`  ${DIM}Opening the workspace in your browser…${RESET}`)
  console.log()

  const webArgs = ["web", ...process.argv.slice(2)]
  const child = isCmdShim(cliPath)
    ? spawn(['"' + cliPath + '"', ...webArgs].join(" "), { stdio: "inherit", shell: true })
    : spawn(cliPath, webArgs, { stdio: "inherit" })
  child.on("close", (code) => process.exit(code ?? 0))
}

main().catch((err) => {
  process.stdout.write(SHOW_CURSOR)
  console.error(err)
  process.exit(1)
})
