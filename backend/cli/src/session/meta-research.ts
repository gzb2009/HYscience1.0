/**
 * Meta-Research Dashboard — cross-project quality trends, blind review
 * aggregation, RSI score distribution, and research efficiency metrics.
 *
 * Runs on startup to compute stats from the on-disk trajectory store.
 */

import path from "path"
import fs from "fs/promises"
import { Global } from "@/global"
import { Log } from "@/util/log"
import { RSITrajectory } from "./rsi/trajectory"
import { Hypothesis } from "./hypothesis"

export namespace MetaResearch {
  const log = Log.create({ service: "meta-research" })
  const DIR = path.join(Global.Path.data, "meta-research")

  export interface Snapshot {
    timestamp: number
    totalSessions: number
    totalTrajectories: number
    avgScore: number
    scoreDistribution: { low: number; mid: number; high: number }
    avgHypothesesPerSession: number
    hypothesisAccuracy: number
    reproducibilityRate: number
    topTools: { name: string; count: number }[]
    agentUsage: Record<string, number>
    trend?: string
  }

  /** Compute snapshot from all on-disk data. */
  export async function compute(): Promise<Snapshot> {
    const trajectories = await RSITrajectory.list().catch(() => [] as string[])

    // Route around session listing
    const scores: number[] = []
    const toolCounts: Record<string, number> = {}
    const agentUsage: Record<string, number> = {}

    let totalTrajectories = 0
    let reproducibilityCount = 0

    for (const sessionId of trajectories) {
      const traj = await RSITrajectory.read(sessionId).catch(() => null)
      if (!traj) continue
      totalTrajectories++
      if (traj.score !== undefined) scores.push(traj.score)
      agentUsage[traj.agent] = (agentUsage[traj.agent] ?? 0) + 1

      for (const step of traj.steps) {
        toolCounts[step.tool] = (toolCounts[step.tool] ?? 0) + 1
      }

      // Check reproducibility
      const reproDir = path.join(Global.Path.data, "reproducibility", sessionId)
      const reproExists = await fs.stat(reproDir).catch(() => null)
      if (reproExists) reproducibilityCount++
    }

    const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
    const low = scores.filter((s) => s < 40).length
    const mid = scores.filter((s) => s >= 40 && s < 75).length
    const high = scores.filter((s) => s >= 75).length

    const topTools = Object.entries(toolCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }))

    // Hypothesis stats (limit to recent sessions for performance)
    let totalHypotheses = 0
    let totalAccuracy = 0
    for (const sessionId of trajectories.slice(0, 50)) {
      const s = await Hypothesis.summary(sessionId).catch(() => null)
      if (s) {
        totalHypotheses += s.total
        totalAccuracy += s.accuracy
      }
    }
    const avgHypotheses = trajectories.length > 0 ? totalHypotheses / Math.min(trajectories.length, 50) : 0
    const hypothesisAccuracy = trajectories.length > 0 ? totalAccuracy / Math.min(trajectories.length, 50) : 0

    const snapshot: Snapshot = {
      timestamp: Date.now(),
      totalSessions: trajectories.length,
      totalTrajectories,
      avgScore: Math.round(avgScore),
      scoreDistribution: { low, mid, high },
      avgHypothesesPerSession: Math.round(avgHypotheses * 10) / 10,
      hypothesisAccuracy: Math.round(hypothesisAccuracy * 100),
      reproducibilityRate: totalTrajectories > 0 ? Math.round((reproducibilityCount / totalTrajectories) * 100) : 0,
      topTools,
      agentUsage,
    }

    // Persist
    await fs.mkdir(DIR, { recursive: true })
    await Bun.write(path.join(DIR, "snapshot.json"), JSON.stringify(snapshot, null, 2))
    log.info("meta-research snapshot computed", { sessions: snapshot.totalSessions, avgScore: snapshot.avgScore })

    return snapshot
  }

  /** Load the latest snapshot. */
  export async function latest(): Promise<Snapshot | null> {
    try {
      return await Bun.file(path.join(DIR, "snapshot.json")).json()
    } catch {
      return null
    }
  }

  /** Render as markdown for display in workspace. */
  export function markdown(s: Snapshot): string {
    return [
      "# Meta-Research Dashboard",
      "",
      `*Generated ${new Date(s.timestamp).toISOString()}*`,
      "",
      "## Overview",
      "",
      `| Metric | Value |`,
      `|--------|-------|`,
      `| Total Sessions | ${s.totalSessions} |`,
      `| Trajectories Analyzed | ${s.totalTrajectories} |`,
      `| Avg RSI Score | ${s.avgScore}/100 |`,
      `| Reproducibility Rate | ${s.reproducibilityRate}% |`,
      `| Avg Hypotheses/Session | ${s.avgHypothesesPerSession} |`,
      `| Hypothesis Accuracy | ${s.hypothesisAccuracy}% |`,
      "",
      "## Score Distribution",
      "",
      `| Band | Count |`,
      `|------|-------|`,
      `| High (≥75) | ${s.scoreDistribution.high} |`,
      `| Mid (40-74) | ${s.scoreDistribution.mid} |`,
      `| Low (<40) | ${s.scoreDistribution.low} |`,
      "",
      "## Top Tools",
      "",
      `| Tool | Uses |`,
      `|------|------|`,
      ...s.topTools.map((t) => `| ${t.name} | ${t.count} |`),
      "",
      "## Agent Usage",
      "",
      `| Agent | Sessions |`,
      `|-------|----------|`,
      ...Object.entries(s.agentUsage).map(([name, count]) => `| ${name} | ${count} |`),
      "",
    ].join("\n")
  }
}
