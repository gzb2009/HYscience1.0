import z from "zod"
import path from "path"
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import { $ } from "bun"
import DESCRIPTION from "./pdf.txt"

const PdfParams = z.object({
  path: z.string(),
  pages: z.string().optional(),
})

export const PdfTool = Tool.define("pdf", async () => {
  return {
    description: DESCRIPTION,
    parameters: PdfParams,
    async execute(params) {
      const cwd = Instance.worktree
      const filepath = path.resolve(cwd, params.path)
      const pageArgs = params.pages
        ? ["-f", params.pages.split("-")[0], "-l", params.pages.split("-")[1] ?? params.pages.split("-")[0]]
        : []
      const result = await $`pdftotext -layout ${pageArgs} ${filepath} -`.cwd(cwd).quiet().nothrow()
      if (result.exitCode !== 0) {
        // Fallback: try Python PyPDF2
        const pyScript = [
          "import sys; sys.path.insert(0, '.')",
          "try:",
          "  from PyPDF2 import PdfReader",
          "except:",
          "  sys.exit(1)",
          `r = PdfReader("${filepath}")`,
          "print('\\n---PAGE---\\n'.join(p.extract_text() or '' for p in r.pages))",
        ]
        const pyResult = await $`python3 -c ${pyScript.join("; ")}`.cwd(cwd).quiet().nothrow()
        if (pyResult.exitCode !== 0)
          throw new Error(
            `PDF extraction failed: pdftotext and PyPDF2 both unavailable. Install pdftotext or pip install PyPDF2.`,
          )
        const text = pyResult.text().trim().slice(0, 50000)
        return { title: `PDF: ${params.path}`, metadata: {}, output: text || "(empty PDF)" }
      }
      const text = result.text().trim().slice(0, 50000)
      return { title: `PDF: ${params.path}`, metadata: {}, output: text || "(empty PDF)" }
    },
  }
})
