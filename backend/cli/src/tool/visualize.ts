import z from "zod"
import path from "path"
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import { $ } from "bun"
import DESCRIPTION from "./visualize.txt"

const VisualizeParams = z.object({
  data: z.string().describe("Path to data file (.csv, .tsv, .json)"),
  type: z.enum(["scatter", "bar", "histogram", "box", "violin", "heatmap", "line"]),
  x: z.string().optional(),
  y: z.string().optional(),
  group: z.string().optional(),
  title: z.string().optional(),
  output: z.string().optional(),
})

export const VisualizeTool = Tool.define("visualize", async () => {
  return {
    description: DESCRIPTION,
    parameters: VisualizeParams,
    async execute(params) {
      const cwd = Instance.worktree
      const dataPath = path.resolve(cwd, params.data)
      const outName = params.output || `viz_${params.type}_${Date.now()}.png`
      const outPath = path.resolve(cwd, "result", outName)
      const outDir = path.dirname(outPath)

      await $`mkdir -p ${outDir}`.quiet()

      const title = params.title ? `"${params.title}"` : "None"

      const script = [
        "import matplotlib",
        "matplotlib.use('Agg')",
        "import matplotlib.pyplot as plt",
        "import pandas as pd",
        "import seaborn as sns",
        "import numpy as np",
        "sns.set_style('whitegrid')",
        `df = pd.read_csv("${dataPath}")`,
        "fig, ax = plt.subplots(figsize=(8, 5))",
      ]

      const columnCheck = (col: string | undefined) => {
        if (!col) throw new Error(`Column '${col}' is required for this plot type`)
        return col
      }

      switch (params.type) {
        case "scatter":
          script.push(
            `sns.scatterplot(data=df, x="${columnCheck(params.x)}", y="${columnCheck(params.y)}"${params.group ? `, hue="${params.group}"` : ""}, ax=ax)`,
          )
          break
        case "bar":
          script.push(
            `sns.barplot(data=df, x="${columnCheck(params.x)}", y="${columnCheck(params.y)}"${params.group ? `, hue="${params.group}"` : ""}, ax=ax)`,
          )
          break
        case "histogram":
          script.push(
            `sns.histplot(data=df, x="${columnCheck(params.x ?? params.y)}"${params.group ? `, hue="${params.group}"` : ""}, kde=True, ax=ax)`,
          )
          break
        case "box":
          script.push(
            `sns.boxplot(data=df, x="${columnCheck(params.x)}", y="${columnCheck(params.y)}"${params.group ? `, hue="${params.group}"` : ""}, ax=ax)`,
          )
          break
        case "violin":
          script.push(
            `sns.violinplot(data=df, x="${columnCheck(params.x)}", y="${columnCheck(params.y)}"${params.group ? `, hue="${params.group}"` : ""}, ax=ax)`,
          )
          break
        case "heatmap":
          script.push("corr = df.select_dtypes(include=[np.number]).corr()")
          script.push("sns.heatmap(corr, annot=True, cmap='RdBu_r', center=0, ax=ax)")
          break
        case "line":
          script.push(
            `sns.lineplot(data=df, x="${columnCheck(params.x)}", y="${columnCheck(params.y)}"${params.group ? `, hue="${params.group}"` : ""}, ax=ax)`,
          )
          break
      }

      script.push(`ax.set_title(${title})`)
      script.push("plt.tight_layout()")
      script.push(`plt.savefig("${outPath}", dpi=150, bbox_inches='tight')`)
      script.push("plt.close()")

      const scriptContent = script.join("\n")
      const scriptPath = path.join(cwd, "result", `.viz_${Date.now()}.py`)

      await Bun.write(scriptPath, scriptContent)
      const result = await $`python3 ${scriptPath}`.cwd(cwd).quiet().nothrow()

      if (result.exitCode !== 0) {
        throw new Error(`Visualization failed:\n${result.stderr.toString()}`)
      }

      return {
        title: `${params.type} plot: ${params.title || outName}`,
        metadata: {},
        output: `Generated ${params.type} plot from ${params.data} → result/${outName}`,
      }
    },
  }
})
