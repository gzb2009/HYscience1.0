export function decodeEntities(value: string) {
  const from = (code: number) => (code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "")
  const once = (text: string) =>
    text
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => from(Number.parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, n) => from(Number(n)))
      .replaceAll("&nbsp;", " ")
      .replaceAll("&quot;", '"')
      .replaceAll("&apos;", "'")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&amp;", "&")
  return once(once(once(value)))
}

export function escapeXml(value: string) {
  return decodeEntities(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

export function plain(value: unknown) {
  if (value == null) return ""
  return decodeEntities(String(value))
}
