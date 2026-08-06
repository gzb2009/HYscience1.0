export type ArtifactData = {
  content?: string
  encoding?: string
  mimeType?: string
}

export function artifactImageUrl(data: ArtifactData | undefined, fallback?: string) {
  if (!data?.content) return ""
  const mime = data.mimeType || fallback || "image/png"
  if (data.encoding === "base64") return `data:${mime};base64,${data.content}`
  if (mime === "image/svg+xml") return `data:${mime};charset=utf-8,${encodeURIComponent(data.content)}`
  return ""
}

export function artifactTable(text: string, name: string, rows = 4) {
  const separator = name.toLowerCase().endsWith(".tsv") ? "\t" : ","
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .slice(0, rows + 1)
  if (!lines.length) return []
  return lines.map((line) => split(line, separator))
}

function split(line: string, separator: string) {
  const cells: string[] = []
  let value = ""
  let quoted = false
  for (let index = 0; index < line.length; index++) {
    const char = line[index]
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"'
        index++
        continue
      }
      quoted = !quoted
      continue
    }
    if (char === separator && !quoted) {
      cells.push(value)
      value = ""
      continue
    }
    value += char
  }
  cells.push(value)
  return cells
}
