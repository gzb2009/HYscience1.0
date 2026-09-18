import { inflateRawSync } from "zlib"

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function u16(value: number) {
  const out = new Uint8Array(2)
  new DataView(out.buffer).setUint16(0, value, true)
  return out
}

function u32(value: number) {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, value, true)
  return out
}

export function zipStore(files: { name: string; data: Uint8Array }[]) {
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const file of files) {
    const name = new TextEncoder().encode(file.name)
    const crc = crc32(file.data)
    const local = [
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(file.data.length),
      u32(file.data.length),
      u16(name.length),
      u16(0),
      name,
      file.data,
    ]
    const localSize = 30 + name.length + file.data.length
    locals.push(...local)
    centrals.push(
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(file.data.length),
      u32(file.data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    )
    offset += localSize
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0)
  const end = [
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralSize),
    u32(offset),
    u16(0),
  ]
  const parts = [...locals, ...centrals, ...end]
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let cursor = 0
  for (const part of parts) {
    bytes.set(part, cursor)
    cursor += part.length
  }
  return bytes
}

export function unzip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const files = new Map<string, Uint8Array>()
  let offset = 0
  while (offset + 30 <= bytes.length) {
    if (view.getUint32(offset, true) !== 0x04034b50) break
    const method = view.getUint16(offset + 8, true)
    const compressed = view.getUint32(offset + 18, true)
    const nameLen = view.getUint16(offset + 26, true)
    const extraLen = view.getUint16(offset + 28, true)
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLen))
    const start = offset + 30 + nameLen + extraLen
    const packed = bytes.subarray(start, start + compressed)
    const data = method === 0 ? packed.slice() : new Uint8Array(inflateRawSync(Buffer.from(packed)))
    files.set(name, data)
    offset = start + compressed
  }
  return files
}

export function xmlText(bytes: Uint8Array | undefined) {
  return bytes ? new TextDecoder().decode(bytes) : ""
}
