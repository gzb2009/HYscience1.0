import { createSignal, onMount, type JSX } from "solid-js"
import { DropdownMenu } from "@hysci/ui/dropdown-menu"
import { useGlobalSDK } from "@/context/global-sdk"
import { useServer } from "@/context/server"
import { useLanguage } from "@/context/language"
import { toast } from "@/thesis/Toast"
import { IconLogOut, IconSettings, IconUser } from "@/thesis/shared/Icon"

export function HomeUserMenu(props: { onSettings: () => void }): JSX.Element {
  const sdk = useGlobalSDK()
  const server = useServer()
  const language = useLanguage()
  const [open, setOpen] = createSignal(false)
  const [email, setEmail] = createSignal("")

  onMount(() => {
    void sdk.client.account
      .get()
      .then((res) => {
        const data = ((res as { data?: { user?: { email?: string } } }).data ?? res) as {
          user?: { email?: string }
        }
        setEmail(data.user?.email ?? "")
      })
      .catch(() => undefined)
  })

  const displayEmail = () => email() || `local@${server.name || "hyscience"}`

  async function signOut() {
    if (!window.confirm(language.t("home.user.signOutConfirm"))) return
    try {
      const res = await sdk.client.account.logout()
      if (res.error) throw new Error(String(res.error))
      setEmail("")
      toast.info(language.t("home.user.signOut"))
    } catch (err) {
      toast.error(language.t("home.user.signOut"), err instanceof Error ? err.message : String(err))
    } finally {
      setOpen(false)
    }
  }

  return (
    <DropdownMenu open={open()} onOpenChange={setOpen} modal={false}>
      <DropdownMenu.Trigger class="cs-workbench-icon-btn" data-expanded={open() ? "true" : "false"}>
        <IconUser size={64} strokeWidth={1.5} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="cs-user-menu mt-2">
          <span class="cs-user-menu-email">{displayEmail()}</span>
          <DropdownMenu.Item
            class="cs-user-menu-item"
            onSelect={() => {
              setOpen(false)
              props.onSettings()
            }}
          >
            <IconSettings size={15} strokeWidth={1.5} />
            {language.t("sidebar.settings")}
          </DropdownMenu.Item>
          <DropdownMenu.Item
            class="cs-user-menu-item"
            onSelect={() => {
              void signOut()
            }}
          >
            <IconLogOut size={15} strokeWidth={1.5} />
            {language.t("home.user.signOut")}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  )
}
