/**
 * App-side inline artifact mount.
 *
 * Backend science tools attach a `metadata.artifact = { kind, data }` envelope to
 * their tool result. `@hysci/ui`'s message-part render path falls back to the
 * renderer registered under `ARTIFACT_TOOL` whenever a tool part carries such an
 * envelope but has no tool-specific renderer. This module registers that
 * renderer, mounting `ScienceArtifact` (which lazily resolves the concrete
 * renderer for the artifact kind, with a graceful JSON fallback).
 *
 * Imported for its side effect from `app.tsx`. Importing `ScienceArtifact` here
 * also pulls in the renderer registry barrel, so every renderer is registered
 * before the first artifact is dispatched.
 */
import { Show } from "solid-js"
import { ARTIFACT_TOOL, ToolRegistry } from "@hysci/ui/message-part"
import { BasicTool } from "@hysci/ui/basic-tool"
import { Markdown } from "@hysci/ui/markdown"
import stripAnsi from "strip-ansi"
import { ScienceArtifact } from "./ScienceArtifact"
import type { ArtifactKind } from "./renderers"

interface ArtifactEnvelope {
  kind: ArtifactKind
  data: unknown
  height?: number
}

function readEnvelope(metadata: Record<string, unknown> | undefined): ArtifactEnvelope | undefined {
  const artifact = metadata?.artifact as ArtifactEnvelope | undefined
  if (!artifact || typeof artifact !== "object" || !("kind" in artifact)) return undefined
  return artifact
}

/**
 * Notebook / R kernel cells: code with syntax highlighting, then stdout /
 * result / traceback, then any captured figures. Both tools share the shape
 * `{ input.code, output, metadata.{ok, output, artifact?} }`.
 */
function kernelRenderer(name: "notebook" | "rkernel", lang: "python" | "r", label: string) {
  ToolRegistry.register({
    name,
    render(props) {
      const code = () => String(props.input?.code ?? "")
      const output = () => stripAnsi(String(props.output || props.metadata?.output || ""))
      const failed = () =>
        props.metadata?.ok === false || /\[ERROR\]|Traceback \(most recent call last\)/.test(output())
      const envelope = () => readEnvelope(props.metadata)
      const lines = () => code().split("\n").length
      return (
        <BasicTool
          {...props}
          icon="console"
          trigger={{
            title: label,
            subtitle: failed() ? "error" : `${lines()} line${lines() === 1 ? "" : "s"}`,
          }}
        >
          <Show when={code()}>
            <div data-component="tool-output" data-scrollable>
              <Markdown text={`\`\`\`${lang}\n${code()}\n\`\`\``} />
            </div>
          </Show>
          <Show when={output() && output() !== "(no output)"}>
            <div data-component="tool-output" data-scrollable data-kernel-output data-failed={failed()}>
              <pre>{output()}</pre>
            </div>
          </Show>
          <Show when={envelope()}>
            {(env) => (
              <div data-component="tool-artifact">
                <ScienceArtifact kind={env().kind} data={env().data} height={env().height} />
              </div>
            )}
          </Show>
        </BasicTool>
      )
    },
  })
}

kernelRenderer("notebook", "python", "Python")
kernelRenderer("rkernel", "r", "R")

ToolRegistry.register({
  name: ARTIFACT_TOOL,
  render(props) {
    const envelope = () => readEnvelope(props.metadata)
    const title = () => props.metadata?.title ?? props.tool ?? "Artifact"
    return (
      <BasicTool
        {...props}
        defaultOpen
        icon="dot-grid"
        trigger={{ title: String(title()), subtitle: envelope()?.kind }}
      >
        <Show when={envelope()}>
          {(env) => (
            <div data-component="tool-artifact">
              <ScienceArtifact kind={env().kind} data={env().data} height={env().height} />
            </div>
          )}
        </Show>
        <Show when={props.output}>
          <div data-component="tool-output" data-scrollable>
            <pre>{stripAnsi(props.output ?? "")}</pre>
          </div>
        </Show>
      </BasicTool>
    )
  },
})
