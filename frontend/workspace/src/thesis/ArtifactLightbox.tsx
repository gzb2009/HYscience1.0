import { createEffect, createSignal, onCleanup, Show, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"
import { artifactImageUrl, type ArtifactData } from "@/utils/artifactPreview"
import type { ImagePreview } from "@/thesis/store/ui"

type Pdfjs = {
  GlobalWorkerOptions: { workerSrc: string }
  getDocument(source: { data: Uint8Array }): {
    promise: Promise<{
      numPages: number
      getPage(page: number): Promise<{
        getViewport(options: { scale: number }): { width: number; height: number }
        render(options: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }): {
          promise: Promise<void>
          cancel(): void
        }
      }>
      destroy(): Promise<void>
    }>
  }
}

export function ArtifactLightbox(props: { artifact: ImagePreview; onClose: () => void }): JSX.Element {
  const sdk = useSDK()
  const language = useLanguage()
  const kind = () => props.artifact.kind ?? (props.artifact.name.toLowerCase().endsWith(".pdf") ? "pdf" : "image")
  const [data, setData] = createSignal<ArtifactData>()
  const [failed, setFailed] = createSignal("")
  const [zoom, setZoom] = createSignal(1)
  const [page, setPage] = createSignal(1)
  const [pages, setPages] = createSignal(1)
  const src = () => artifactImageUrl(data(), props.artifact.mime)
  const clampZoom = (value: number) => setZoom(Math.min(6, Math.max(0.25, value)))

  createEffect(() => {
    const directory = props.artifact.directory
    const path = props.artifact.path
    setData(undefined)
    setFailed("")
    setZoom(1)
    setPage(1)
    setPages(1)
    if (!directory || !path) return
    void sdk.client.file
      .read({ directory, path })
      .then((res) => {
        const payload = res as { data?: ArtifactData }
        setData(payload.data ?? (res as ArtifactData))
      })
      .catch((error: { message?: string }) => setFailed(error?.message ?? "read failed"))
  })

  createEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        props.onClose()
        return
      }
      if (event.key === "+" || event.key === "=") {
        event.preventDefault()
        clampZoom(zoom() + 0.25)
        return
      }
      if (event.key === "-" || event.key === "_") {
        event.preventDefault()
        clampZoom(zoom() - 0.25)
        return
      }
      if (kind() !== "pdf") return
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault()
        setPage((value) => Math.min(pages(), value + 1))
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault()
        setPage((value) => Math.max(1, value - 1))
      }
    }
    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })

  return (
    <Portal>
      <div
        class="cs-artifact-lightbox"
        role="dialog"
        aria-modal="true"
        aria-label={props.artifact.name}
        onClick={props.onClose}
      >
        <header class="cs-artifact-lightbox-bar" onClick={(event) => event.stopPropagation()}>
          <span class="cs-artifact-lightbox-name">{props.artifact.name}</span>
          <Show when={kind() === "pdf"}>
            <span class="cs-artifact-lightbox-pages">
              <button type="button" disabled={page() <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
                ‹
              </button>
              {page()} / {pages()}
              <button
                type="button"
                disabled={page() >= pages()}
                onClick={() => setPage((value) => Math.min(pages(), value + 1))}
              >
                ›
              </button>
            </span>
          </Show>
          <span class="cs-artifact-lightbox-zoom">
            <button type="button" onClick={() => clampZoom(zoom() - 0.25)}>
              −
            </button>
            <button type="button" onClick={() => setZoom(1)}>
              {Math.round(zoom() * 100)}%
            </button>
            <button type="button" onClick={() => clampZoom(zoom() + 0.25)}>
              +
            </button>
          </span>
          <button type="button" class="cs-artifact-lightbox-close" onClick={props.onClose}>
            {language.t("common.close")}
          </button>
        </header>
        <div
          class="cs-artifact-lightbox-stage"
          onClick={(event) => event.stopPropagation()}
          onWheel={(event) => {
            event.preventDefault()
            clampZoom(zoom() + (event.deltaY < 0 ? 0.2 : -0.2))
          }}
        >
          <Show when={failed()}>
            <p class="cs-artifact-lightbox-empty">{failed()}</p>
          </Show>
          <Show when={!failed() && kind() === "image"}>
            <Show when={src()} fallback={<p class="cs-artifact-lightbox-empty">loading…</p>}>
              <img
                src={src()}
                alt={props.artifact.name}
                style={{ transform: `scale(${zoom()})` }}
                onClick={() => setZoom(zoom() === 1 ? 2 : 1)}
              />
            </Show>
          </Show>
          <Show when={!failed() && kind() === "pdf"}>
            <PdfStage data={data()} page={page()} zoom={zoom()} onPages={setPages} />
          </Show>
        </div>
      </div>
    </Portal>
  )
}

function PdfStage(props: {
  data: ArtifactData | undefined
  page: number
  zoom: number
  onPages: (count: number) => void
}): JSX.Element {
  let canvas!: HTMLCanvasElement

  createEffect(() => {
    const file = props.data
    const pageNumber = props.page
    const zoom = props.zoom
    if (!file?.content || file.encoding !== "base64") return

    let disposed = false
    let task: { cancel(): void } | undefined
    let doc: { destroy(): Promise<void> } | undefined

    void (async () => {
      try {
        const pdfjs = (await import("pdfjs-dist")) as unknown as Pdfjs
        if (!pdfjs.GlobalWorkerOptions.workerSrc) {
          pdfjs.GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default
        }
        const bytes = Uint8Array.from(atob(file.content!), (char) => char.charCodeAt(0))
        const loaded = await pdfjs.getDocument({ data: bytes }).promise
        if (disposed) {
          await loaded.destroy()
          return
        }
        doc = loaded
        props.onPages(loaded.numPages)
        const page = await loaded.getPage(Math.min(pageNumber, loaded.numPages))
        if (disposed) return
        const viewport = page.getViewport({ scale: 1.35 * zoom })
        const ratio = window.devicePixelRatio || 1
        canvas.width = Math.floor(viewport.width * ratio)
        canvas.height = Math.floor(viewport.height * ratio)
        canvas.style.width = `${Math.floor(viewport.width)}px`
        canvas.style.height = `${Math.floor(viewport.height)}px`
        const context = canvas.getContext("2d")
        if (!context) return
        context.setTransform(ratio, 0, 0, ratio, 0, 0)
        const rendered = page.render({ canvasContext: context, viewport })
        task = rendered
        await rendered.promise
      } catch {
        // Keep the empty canvas; the header still identifies the file.
      }
    })()

    onCleanup(() => {
      disposed = true
      task?.cancel()
      void doc?.destroy()
    })
  })

  return <canvas ref={canvas} class="cs-artifact-lightbox-pdf" />
}
