/**
 * Reproducibility Compiler — scans session tool executions to extract
 * environment metadata and generates a self-contained reproducibility pack
 * (Dockerfile + conda-lock.yml + run script).
 */

import path from "path"
import fs from "fs/promises"
import { Global } from "@/global"
import { Log } from "@/util/log"

export namespace Reproducibility {
  const log = Log.create({ service: "reproducibility" })
  const DIR = path.join(Global.Path.data, "reproducibility")

  export interface Environment {
    python?: string
    conda?: string
    r?: string
    gpu?: { cuda: string; driver: string }
    packages: { name: string; version?: string }[]
    system?: { os: string; arch: string }
    shell: string
    urls: string[]
  }

  export interface Scan {
    environments: Environment[]
    datasetPaths: string[]
    scriptPaths: string[]
    totalCommands: number
  }

  /**
   * Scan session messages for exec_command tool calls to extract
   * environment metadata and data paths.
   */
  export function scan(
    messages: {
      parts: {
        type: string
        tool?: string
        state?: { input?: { command?: string }; output?: string; metadata?: { output?: string } }
      }[]
      info: { role: string; time: { created: number } }
    }[],
  ): Scan {
    const envs: Environment[] = []
    const datasets: Set<string> = new Set()
    const scripts: Set<string> = new Set()
    let totalCommands = 0

    for (const msg of messages) {
      if (msg.info.role !== "assistant") continue
      for (const part of msg.parts) {
        if (part.type !== "tool") continue
        const cmd = part.state?.input?.command ?? ""
        if (!cmd) continue

        totalCommands++

        // Extract Python version
        const pyMatch = cmd.match(/(?:python|python3)\s+(?:--version|-V|--version)/)
        const pyInline = cmd.match(/Python\s+(\d+\.\d+\.\d+)/)
        if (pyMatch || pyInline) {
          const env = getEnv(envs, part.state?.output ?? part.state?.metadata?.output ?? "")
          env.python = pyInline?.[1] ?? "unknown"
        }

        // Extract pip install commands
        const pipMatch = cmd.match(/pip(?:3)?\s+install\s+(?:--[a-z-]+\s+)*([a-zA-Z0-9_-]+(?:[=<>~!]=?\s*\S+)?)/)
        if (pipMatch) {
          const env = getEnv(envs, "")
          const parts = pipMatch[1].split(/[=<>~!]=?/)
          env.packages.push({ name: parts[0], version: parts[1] || undefined })
        }

        // Extract conda install
        const condaMatch = cmd.match(/conda\s+install\s+(?:--[a-z-]+\s+)*([a-zA-Z0-9_-]+(?:=\S+)?)/)
        if (condaMatch) {
          const env = getEnv(envs, "")
          const parts = condaMatch[1].split("=")
          env.packages.push({ name: parts[0], version: parts[1] || undefined })
        }

        // Extract conda info
        const condaInfoMatch = cmd.match(/conda\s+--version/)
        if (condaInfoMatch) {
          const env = getEnv(envs, part.state?.output ?? part.state?.metadata?.output ?? "")
          const verMatch = (part.state?.output ?? "").match(/conda\s+(\d+\.\d+\.\d+)/)
          if (verMatch) env.conda = verMatch[1]
        }

        // Extract R version
        const rMatch = cmd.match(/R\s+--version|Rscript\s+--version/)
        if (rMatch) {
          const env = getEnv(envs, part.state?.output ?? part.state?.metadata?.output ?? "")
          const verMatch = (part.state?.output ?? "").match(/R\s+version\s+(\d+\.\d+\.\d+)/)
          if (verMatch) env.r = verMatch[1]
        }

        // Extract nvidia-smi / CUDA info
        const cudaMatch = cmd.match(/nvidia-smi/)
        if (cudaMatch) {
          const output = part.state?.output ?? part.state?.metadata?.output ?? ""
          const env = getEnv(envs, output)
          const cudaVer = output.match(/CUDA\s+Version:\s*(\d+\.\d+)/)
          const driverVer = output.match(/Driver\s+Version:\s*(\d+\.\d+)/)
          if (cudaVer || driverVer) {
            env.gpu = {
              cuda: cudaVer?.[1] ?? "unknown",
              driver: driverVer?.[1] ?? "unknown",
            }
          }
        }

        // Extract uname
        const unameMatch = cmd.match(/^uname\s+-a/)
        if (unameMatch) {
          const output = part.state?.output ?? part.state?.metadata?.output ?? ""
          const env = getEnv(envs, output)
          if (output.includes("Darwin"))
            env.system = { os: "macOS", arch: output.includes("arm64") ? "arm64" : "x86_64" }
          else if (output.includes("Linux"))
            env.system = { os: "Linux", arch: output.includes("x86_64") ? "x86_64" : "aarch64" }
        }

        // Extract dataset paths (reads, downloads, loads)
        const filePath = cmd.match(/(?:--input|--data|-i|-d|--output|-o)\s+(\S+)/g)
        if (filePath) {
          for (const fp of filePath) {
            const name = fp.split(/\s+/).pop() ?? ""
            if (/\.(csv|tsv|h5ad|fastq|bam|vcf|json|parquet|npy|npz|h5|pkl|rds)$/i.test(name)) {
              datasets.add(name)
            }
          }
        }
        const wgetCurl = cmd.match(/(?:wget|curl)\s+(?:-O\s+)?(\S+)\s+(https?:\/\/\S+)/)
        if (wgetCurl) {
          if (!datasets.has("")) datasets.add(wgetCurl[2])
        }

        // Extract script paths
        const scriptMatch = cmd.match(/(?:python|python3|Rscript|bash|\.\/)\s+(\S+\.(?:py|R|sh|ipynb))/)
        if (scriptMatch) scripts.add(scriptMatch[1])
      }
    }

    // Ensure at least one environment entry
    if (envs.length === 0) {
      envs.push({
        packages: [],
        system: { os: process.platform, arch: process.arch },
        shell: process.env.SHELL ?? "bash",
        urls: [],
      })
    }

    return {
      environments: envs,
      datasetPaths: [...datasets],
      scriptPaths: [...scripts],
      totalCommands,
    }
  }

  function getEnv(envs: Environment[], output: string): Environment {
    if (envs.length === 0) {
      envs.push({
        packages: [],
        system: { os: process.platform, arch: process.arch },
        shell: process.env.SHELL ?? "bash",
        urls: [],
      })
    }
    // URLs in output
    const urls = output.match(/https?:\/\/\S+/g) ?? []
    envs[0].urls.push(...urls)
    return envs[0]
  }

  /** Generate a Dockerfile from the scan results. */
  export function dockerfile(scan: Scan): string {
    const env = scan.environments[0]
    if (!env) return "# No environment detected"

    const lines: string[] = []

    if (env.python) {
      lines.push(`FROM python:${env.python}-slim`)
    } else if (env.r) {
      lines.push(`FROM rocker/r-ver:${env.r}`)
    } else {
      lines.push("FROM ubuntu:22.04")
    }

    lines.push("")
    lines.push("WORKDIR /workspace")
    lines.push("")

    // System deps
    lines.push("RUN apt-get update && apt-get install -y \\")
    lines.push("    curl wget git build-essential \\")
    if (env.gpu) lines.push("    && echo 'GPU enabled' \\")
    lines.push("    && rm -rf /var/lib/apt/lists/*")
    lines.push("")

    // Python packages
    if (env.packages.length > 0) {
      const pips = env.packages.filter((p) => !p.name.startsWith("bioconductor"))
      if (pips.length > 0) {
        lines.push("# Python packages")
        const installs = pips.map((p) => `${p.name}${p.version ? "==" + p.version : ""}`)
        lines.push(`RUN pip install ${installs.join(" ")}`)
        lines.push("")
      }
    }

    // Conda
    if (env.conda) {
      lines.push("# Conda environment")
      lines.push("RUN conda install -y conda=" + env.conda)
      lines.push("")
    }

    // Scripts
    if (scan.scriptPaths.length > 0) {
      lines.push("# Copy project scripts")
      for (const script of scan.scriptPaths) {
        lines.push(`COPY ${script} /workspace/`)
      }
      lines.push("")
    }

    // Data
    if (scan.datasetPaths.length > 0) {
      lines.push("# Data files (download or mount)")
      for (const ds of scan.datasetPaths.slice(0, 5)) {
        lines.push(`# ${ds}`)
      }
      lines.push("")
    }

    // Entry point
    if (scan.scriptPaths.length > 0) {
      const main = scan.scriptPaths[0]
      const ext = path.extname(main)
      if (ext === ".py") lines.push(`CMD ["python", "${main}"]`)
      else if (ext === ".R") lines.push(`CMD ["Rscript", "${main}"]`)
      else if (ext === ".sh") lines.push(`CMD ["bash", "${main}"]`)
    }

    return lines.join("\n")
  }

  /** Generate a conda-lock.yml compatible spec. */
  export function condaLock(scan: Scan): string {
    const env = scan.environments[0]
    if (!env) return ""

    const lines = [
      "name: hyscience-reproducible",
      "channels:",
      "  - conda-forge",
      "  - bioconda",
      "  - defaults",
      "dependencies:",
    ]

    if (env.python) lines.push(`  - python=${env.python}`)
    if (env.r) lines.push(`  - r-base=${env.r}`)

    for (const pkg of env.packages) {
      if (pkg.version) lines.push(`  - ${pkg.name}=${pkg.version}`)
      else lines.push(`  - ${pkg.name}`)
    }

    return lines.join("\n")
  }

  /** Write the full reproducibility pack to disk. */
  export async function write(sessionId: string, scan: Scan): Promise<string> {
    const dir = path.join(DIR, sessionId)
    await fs.mkdir(dir, { recursive: true })

    await Bun.write(path.join(dir, "Dockerfile"), dockerfile(scan))
    await Bun.write(path.join(dir, "environment.yml"), condaLock(scan))
    await Bun.write(path.join(dir, "scan.json"), JSON.stringify(scan, null, 2))

    // Generate a runner script
    const runScript = [
      "#!/usr/bin/env bash",
      "# Generated by HYscience Reproducibility Compiler",
      `# Session: ${sessionId}`,
      `# Commands: ${scan.totalCommands}`,
      `# Scripts: ${scan.scriptPaths.join(", ")}`,
      "",
      "set -euo pipefail",
      "",
      "# Option 1: Docker",
      "# docker build -t hyscience-reproducible -f Dockerfile .",
      "# docker run --rm -v $(pwd):/workspace hyscience-reproducible",
      "",
      "# Option 2: Conda",
      "# conda env create -f environment.yml",
      "# conda activate hyscience-reproducible",
    ].join("\n")
    await Bun.write(path.join(dir, "run.sh"), runScript)

    log.info("reproducibility pack written", { sessionId, dir })
    return dir
  }

  /** Pipeline entry point — scan and write. Fire-and-forget safe. */
  export async function compile(sessionId: string, messages: any[]): Promise<string | undefined> {
    try {
      const scanResult = scan(messages)
      if (scanResult.totalCommands === 0) {
        log.info("no commands to compile", { sessionId })
        return undefined
      }
      const dir = await write(sessionId, scanResult)
      return dir
    } catch (e) {
      log.warn("reproducibility compile failed", { error: e instanceof Error ? e.message : String(e) })
      return undefined
    }
  }
}
