import z from "zod"
import path from "path"
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import DESCRIPTION from "./image.txt"

const ImageParams = z.object({
  path: z.string(),
})

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
}

export const ImageTool = Tool.define("image", async () => {
  return {
    description: DESCRIPTION,
    parameters: ImageParams,
    async execute(params) {
      const cwd = Instance.worktree
      const filepath = path.resolve(cwd, params.path)
      const file = Bun.file(filepath)
      if (!(await file.exists())) throw new Error(`File not found: ${params.path}`)

      const ext = path.extname(params.path).toLowerCase()
      const mime = MIME[ext]
      if (!mime) throw new Error(`Unsupported image format: ${ext}. Supported: png, jpg, jpeg, webp, gif, bmp`)

      const size = file.size
      if (size > 10 * 1024 * 1024) throw new Error("Image too large (>10MB)")

      const bytes = await file.bytes()
      const base64 = Buffer.from(bytes).toString("base64")
      const dataUrl = `data:${mime};base64,${base64}`

      return {
        title: `Image: ${path.basename(params.path)} (${mime}, ${(size / 1024).toFixed(1)}KB)`,
        metadata: {},
        output: dataUrl,
      }
    },
  }
})
