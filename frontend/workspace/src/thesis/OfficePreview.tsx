import { For, Show, type JSX } from "solid-js"

export type OfficePreviewData = {
  kind?: "xlsx" | "docx" | "pptx"
  sheets?: { name: string; rows: string[][] }[]
  blocks?: { type: "heading" | "paragraph" | "table"; text?: string; rows?: string[][] }[]
  slides?: { title: string; lines: string[] }[]
}

function decode(value: string) {
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

function letter(index: number): string {
  if (index < 26) return String.fromCharCode(65 + index)
  return letter(Math.floor(index / 26) - 1) + letter(index % 26)
}

function width(rows: string[][]) {
  return Math.max(1, ...rows.map((row) => row.length))
}

function notes(rows: string[][]) {
  if (!rows.length) return false
  return width(rows) <= 1
}

function Grid(props: { rows: string[][]; sheet?: boolean }): JSX.Element {
  const cols = () => width(props.rows)
  const head = () => (props.rows[0] ?? []).map((cell) => decode(cell ?? ""))
  const body = () => props.rows.slice(1).map((row) => row.map((cell) => decode(cell ?? "")))
  return (
    <div class="hy-office-grid-wrap">
      <table class="hy-office-table" data-sheet={props.sheet ? "true" : undefined}>
        <Show when={props.sheet}>
          <thead>
            <tr data-role="gutter">
              <th />
              <For each={Array.from({ length: cols() }, (_, index) => letter(index))}>{(col) => <th>{col}</th>}</For>
            </tr>
            <tr>
              <th data-role="gutter">1</th>
              <For each={head()}>{(cell) => <th>{cell}</th>}</For>
            </tr>
          </thead>
        </Show>
        <Show when={!props.sheet}>
          <thead>
            <tr>
              <For each={head()}>{(cell) => <th>{cell}</th>}</For>
            </tr>
          </thead>
        </Show>
        <tbody>
          <For each={body()}>
            {(row, index) => (
              <tr>
                <Show when={props.sheet}>
                  <th data-role="gutter">{index() + 2}</th>
                </Show>
                <For each={Array.from({ length: cols() }, (_, col) => row[col] ?? "")}>{(cell) => <td>{cell}</td>}</For>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  )
}

function Notes(props: { name?: string; rows: string[][] }): JSX.Element {
  const lines = () =>
    props.rows
      .flat()
      .map((cell) => decode(cell))
      .filter(Boolean)
  return (
    <section class="hy-office-notes">
      <Show when={props.name}>
        <h3>{decode(props.name ?? "")}</h3>
      </Show>
      <For each={lines()}>{(line, index) => <p data-lead={index() === 0 ? "true" : undefined}>{line}</p>}</For>
    </section>
  )
}

export function OfficePreview(props: { preview?: OfficePreviewData; compact?: boolean }): JSX.Element {
  const preview = () => props.preview
  return (
    <Show when={preview()?.kind} fallback={<div class="hy-office-empty">无法预览此办公文件</div>}>
      <div class="hy-office-preview" data-kind={preview()?.kind} data-compact={props.compact ? "true" : "false"}>
        <Show when={preview()?.kind === "xlsx"}>
          <For each={preview()?.sheets ?? []}>
            {(sheet) => (
              <Show
                when={notes(sheet.rows)}
                fallback={
                  <section class="hy-office-sheet">
                    <div class="hy-office-sheet-tab">{decode(sheet.name)}</div>
                    <Grid rows={sheet.rows} sheet />
                  </section>
                }
              >
                <Notes name={sheet.name} rows={sheet.rows} />
              </Show>
            )}
          </For>
        </Show>
        <Show when={preview()?.kind === "docx"}>
          <For each={preview()?.blocks ?? []}>
            {(block) => (
              <Show when={block.type === "table"} fallback={<p data-type={block.type}>{decode(block.text ?? "")}</p>}>
                <Show when={notes(block.rows ?? [])} fallback={<Grid rows={block.rows ?? []} />}>
                  <Notes rows={block.rows ?? []} />
                </Show>
              </Show>
            )}
          </For>
        </Show>
        <Show when={preview()?.kind === "pptx"}>
          <For each={preview()?.slides ?? []}>
            {(slide) => (
              <section class="hy-office-slide">
                <h3>{decode(slide.title)}</h3>
                <For each={slide.lines}>{(line) => <p>{decode(line)}</p>}</For>
              </section>
            )}
          </For>
        </Show>
      </div>
    </Show>
  )
}
