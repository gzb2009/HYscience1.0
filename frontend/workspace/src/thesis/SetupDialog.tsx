// First-run setup — browser equivalent of `hyscience init`. BYOK only in local-first builds.
import { type JSX, For, Show, createSignal } from "solid-js"
import { Dialog } from "@hysci/ui/dialog"
import { useDialog } from "@hysci/ui/context/dialog"
import { Button } from "@hysci/ui/button"
import { TextField } from "@hysci/ui/text-field"
import { useGlobalSDK } from "@/context/global-sdk"
import { FONT_MONO, FONT_SANS } from "@/styles/tokens"

export const SETUP_DISMISS_KEY = "hyscience.setup.dismissed"

export function readSetupDismissed(): boolean {
  try {
    return localStorage.getItem(SETUP_DISMISS_KEY) === "1"
  } catch {
    return false
  }
}

export function openSetupDialog(dialog: ReturnType<typeof useDialog>, onDismiss?: () => void) {
  dialog.show(() => <SetupDialog onDismiss={onDismiss} />)
}

const BYOK_PROVIDERS: { id: string; label: string; placeholder: string }[] = [
  { id: "anthropic", label: "Anthropic", placeholder: "sk-ant-…" },
  { id: "openai", label: "OpenAI", placeholder: "sk-…" },
  { id: "google", label: "Google", placeholder: "AIza…" },
  { id: "openrouter", label: "OpenRouter", placeholder: "sk-or-…" },
]

type View = "choose" | "byok" | "done"

export function SetupDialog(props: { onDismiss?: () => void }): JSX.Element {
  const dialog = useDialog()
  const sdk = useGlobalSDK()

  const [view, setView] = createSignal<View>("choose")
  const [provider, setProvider] = createSignal(BYOK_PROVIDERS[0].id)
  const [byokKey, setByokKey] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string>()

  const dismiss = () => {
    try {
      localStorage.setItem(SETUP_DISMISS_KEY, "1")
    } catch {}
    props.onDismiss?.()
    dialog.close()
  }

  const saveByok = async () => {
    if (busy()) return
    const k = byokKey().trim()
    if (!k) return
    setBusy(true)
    setError(undefined)
    try {
      await sdk.client.auth.set({ providerID: provider(), auth: { type: "api", key: k } })
      await sdk.client.global.sync()
      setView("done")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title="Set up HYscience" description="Add a provider key to start running models locally." size="normal">
      <div style={{ display: "flex", "flex-direction": "column", gap: "16px", "font-family": FONT_SANS }}>
        <Show when={view() === "choose"}>
          <p class="text-13-regular text-text-weak">
            HYscience runs on your machine with your own API keys. Nothing leaves your account unless you run a command
            that calls a provider.
          </p>
          <div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
            <Button variant="primary" onClick={() => setView("byok")}>
              Add provider key
            </Button>
            <Button variant="ghost" onClick={dismiss}>
              Not now
            </Button>
          </div>
        </Show>

        <Show when={view() === "byok"}>
          <label class="text-12-regular text-text-weak">Provider</label>
          <select
            value={provider()}
            onChange={(e) => setProvider(e.currentTarget.value)}
            style={{ padding: "8px", "border-radius": "4px", border: "1px solid var(--color-border-weak-base)" }}
          >
            <For each={BYOK_PROVIDERS}>{(p) => <option value={p.id}>{p.label}</option>}</For>
          </select>
          <TextField
            label="API key"
            type="password"
            placeholder={BYOK_PROVIDERS.find((p) => p.id === provider())?.placeholder ?? "sk-…"}
            value={byokKey()}
            onChange={setByokKey}
          />
          <Show when={error()}>
            <p class="text-12-regular" style={{ color: "var(--color-error)" }}>
              {error()}
            </p>
          </Show>
          <div style={{ display: "flex", gap: "8px" }}>
            <Button variant="primary" disabled={busy() || !byokKey().trim()} onClick={saveByok}>
              Save key
            </Button>
            <Button variant="ghost" onClick={() => setView("choose")}>
              Back
            </Button>
          </div>
        </Show>

        <Show when={view() === "done"}>
          <p class="text-13-regular text-text-weak">Provider key saved. You can add more keys anytime in Settings → Credentials.</p>
          <Button variant="primary" onClick={() => dialog.close()}>
            Done
          </Button>
        </Show>
      </div>
      <style>{`code { font-family: ${FONT_MONO}; font-size: 11px; }`}</style>
    </Dialog>
  )
}
