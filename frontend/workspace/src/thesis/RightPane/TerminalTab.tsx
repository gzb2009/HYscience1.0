import { For, Show, type JSX } from "solid-js"
import { useSDK } from "@/context/sdk"
import { useTerminal } from "@/context/terminal"
import { Terminal } from "@/components/terminal"
import { toast } from "@/thesis/Toast"

export function TerminalTab(): JSX.Element {
  const terminal = useTerminal()
  const sdk = useSDK()
  const local = () => {
    try {
      const host = new URL(sdk.url).hostname
      return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]"
    } catch {
      return false
    }
  }

  return (
    <Show
      when={local()}
      fallback={<div style={empty()}>Terminal is available only with a local HYscience server.</div>}
    >
      <div style={{ flex: 1, "min-height": 0, display: "flex", "flex-direction": "column" }}>
        <div style={terminalHeader()}>
          <span>Terminal</span>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={() => terminal.new()} style={smallButton()}>
            New
          </button>
        </div>
        <Show
          when={terminal.all().length > 0}
          fallback={<div style={empty()}>Create a terminal to run commands in this project.</div>}
        >
          <div
            style={{ display: "flex", gap: "4px", padding: "6px", "border-bottom": "1px solid var(--color-border)" }}
          >
            <For each={terminal.all()}>
              {(pty) => (
                <button
                  type="button"
                  onClick={() => terminal.open(pty.id)}
                  style={terminalTab(terminal.active() === pty.id)}
                >
                  <span>{pty.title}</span>
                  <span
                    onClick={(event) => {
                      event.stopPropagation()
                      void terminal.close(pty.id)
                    }}
                  >
                    ×
                  </span>
                </button>
              )}
            </For>
          </div>
          <div style={{ flex: 1, "min-height": 0, position: "relative" }}>
            <For each={terminal.all()}>
              {(pty) => (
                <div
                  style={{ position: "absolute", inset: 0, display: terminal.active() === pty.id ? "block" : "none" }}
                >
                  <Terminal
                    pty={pty}
                    onCleanup={(next) => terminal.update(next)}
                    onConnectError={(error) =>
                      toast.error("terminal disconnected", error instanceof Error ? error.message : String(error))
                    }
                  />
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  )
}

function terminalHeader(): JSX.CSSProperties {
  return {
    display: "flex",
    "align-items": "center",
    gap: "6px",
    padding: "8px 10px",
    "border-bottom": "1px solid var(--color-border)",
    "font-family": "var(--font-mono)",
    "font-size": "12px",
    "font-weight": 600,
    color: "var(--color-text)",
  }
}

function smallButton(): JSX.CSSProperties {
  return {
    all: "unset",
    cursor: "pointer",
    padding: "4px 8px",
    border: "1px solid var(--color-border)",
    "border-radius": "4px",
    "font-family": "var(--font-mono)",
    "font-size": "10px",
    color: "var(--color-text)",
  }
}

function terminalTab(active: boolean): JSX.CSSProperties {
  return {
    ...smallButton(),
    display: "inline-flex",
    "align-items": "center",
    gap: "6px",
    background: active ? "var(--color-accent-subtle)" : "transparent",
  }
}

function empty(): JSX.CSSProperties {
  return {
    flex: 1,
    display: "grid",
    "place-items": "center",
    padding: "24px",
    "text-align": "center",
    "font-family": "var(--font-sans)",
    "font-size": "12px",
    color: "var(--color-text-faint)",
  }
}
