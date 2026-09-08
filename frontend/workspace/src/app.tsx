import "@/index.css"
import { ErrorBoundary, Show, lazy, type ParentProps } from "solid-js"
import { Router, Route, Navigate } from "@solidjs/router"
import { MetaProvider } from "@solidjs/meta"
import { Font } from "@hysci/ui/font"
import { MarkedProvider } from "@hysci/ui/context/marked"
import { DiffComponentProvider } from "@hysci/ui/context/diff"
import { CodeComponentProvider } from "@hysci/ui/context/code"
import { I18nProvider } from "@hysci/ui/context"
import { Diff } from "@hysci/ui/diff"
import { Code } from "@hysci/ui/code"
import { ThemeProvider } from "@hysci/ui/theme"
import { GlobalSyncProvider } from "@/context/global-sync"
import { PermissionProvider } from "@/context/permission"
import { LayoutProvider } from "@/context/layout"
import { GlobalSDKProvider } from "@/context/global-sdk"
import { normalizeServerUrl, ServerProvider, useServer } from "@/context/server"
import { SettingsProvider } from "@/context/settings"
import { TerminalProvider } from "@/context/terminal"
import { PromptProvider } from "@/context/prompt"
import { FileProvider } from "@/context/file"
import { CommentsProvider } from "@/context/comments"
import { NotificationProvider } from "@/context/notification"
import { ModelsProvider } from "@/context/models"
import { DialogProvider } from "@hysci/ui/context/dialog"
import { CommandProvider } from "@/context/command"
import { LanguageProvider, useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { HighlightsProvider } from "@/context/highlights"
import Layout from "@/pages/layout"
import DirectoryLayout from "@/pages/directory-layout"
import { ErrorPage } from "./pages/error"
import { URLS } from "@/config/urls"
// Side effect: registers the inline science-artifact tool renderer + pulls in
// the renderer registry so `metadata.artifact` envelopes render in chat.
import "@/science/tool-renderer"
import { Suspense } from "solid-js"
import { AgentIcon } from "@/thesis/shared/AgentIcon"

const Home = lazy(() => import("@/pages/home"))
const DomainGuide = lazy(() => import("@/pages/domain-guide"))
const HomeEntry = lazy(() => import("@/pages/home-entry"))
const Session = lazy(() => import("@/pages/session"))
const Loading = () => (
  <div class="size-full" style={{ display: "flex", "align-items": "center", "justify-content": "center" }}>
    <AgentIcon size={18} animated style={{ color: "var(--color-text-faint)" }} />
  </div>
)

function UiI18nBridge(props: ParentProps) {
  const language = useLanguage()
  return <I18nProvider value={{ locale: language.locale, t: language.t }}>{props.children}</I18nProvider>
}

declare global {
  interface Window {
    __HYSCIENCE__?: { updaterEnabled?: boolean; deepLinks?: string[] }
    __HYSCIENCE_BASE_URL__?: string
  }
}

function MarkedProviderWithNativeParser(props: ParentProps) {
  const platform = usePlatform()
  return <MarkedProvider nativeParser={platform.parseMarkdown}>{props.children}</MarkedProvider>
}

export function AppBaseProviders(props: ParentProps) {
  return (
    <MetaProvider>
      <Font />
      <ThemeProvider>
        <LanguageProvider>
          <UiI18nBridge>
            <ErrorBoundary fallback={(error) => <ErrorPage error={error} />}>
              <DialogProvider>
                <MarkedProviderWithNativeParser>
                  <DiffComponentProvider component={Diff}>
                    <CodeComponentProvider component={Code}>{props.children}</CodeComponentProvider>
                  </DiffComponentProvider>
                </MarkedProviderWithNativeParser>
              </DialogProvider>
            </ErrorBoundary>
          </UiI18nBridge>
        </LanguageProvider>
      </ThemeProvider>
    </MetaProvider>
  )
}

function ServerKey(props: ParentProps) {
  const server = useServer()
  return (
    <Show when={server.url} keyed>
      {props.children}
    </Show>
  )
}

export function AppInterface(props: { defaultUrl?: string }) {
  const platform = usePlatform()

  const stored = (() => {
    if (platform.platform !== "web") return
    const result = platform.getDefaultServerUrl?.()
    if (result instanceof Promise) return
    if (!result) return
    return normalizeServerUrl(result)
  })()

  const localDevUrl = () => {
    const host = import.meta.env.VITE_HYSCIENCE_SERVER_HOST === "localhost" || !import.meta.env.VITE_HYSCIENCE_SERVER_HOST
      ? "127.0.0.1"
      : import.meta.env.VITE_HYSCIENCE_SERVER_HOST
    const port = import.meta.env.VITE_HYSCIENCE_SERVER_PORT ?? "4096"
    return `http://${host}:${port}`
  }

  const usableStored = () => {
    if (!stored) return
    if (!import.meta.env.DEV) return stored
    try {
      const url = new URL(stored)
      const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost"
      const port = url.port || (url.protocol === "https:" ? "443" : "80")
      const expected = import.meta.env.VITE_HYSCIENCE_SERVER_PORT ?? "4096"
      if (loopback && port !== expected) return
    } catch {
      return
    }
    return stored
  }

  const defaultServerUrl = () => {
    if (props.defaultUrl) return props.defaultUrl
    if (usableStored()) return usableStored()
    if (location.hostname.includes(URLS.host)) return "http://127.0.0.1:4096"
    if (import.meta.env.DEV) return localDevUrl()

    return window.location.origin
  }

  return (
    <ServerProvider defaultUrl={defaultServerUrl()}>
      <ServerKey>
        <GlobalSDKProvider>
          <GlobalSyncProvider>
            <Router
              root={(props) => (
                <SettingsProvider>
                  <PermissionProvider>
                    <LayoutProvider>
                      <NotificationProvider>
                        <ModelsProvider>
                          <CommandProvider>
                            <HighlightsProvider>
                              <Layout>{props.children}</Layout>
                            </HighlightsProvider>
                          </CommandProvider>
                        </ModelsProvider>
                      </NotificationProvider>
                    </LayoutProvider>
                  </PermissionProvider>
                </SettingsProvider>
              )}
            >
              <Route
                path="/"
                component={() => (
                  <Suspense fallback={<Loading />}>
                    <HomeEntry />
                  </Suspense>
                )}
              />
              <Route
                path="/domains"
                component={() => (
                  <Suspense fallback={<Loading />}>
                    <DomainGuide />
                  </Suspense>
                )}
              />
              <Route
                path="/domain/:id"
                component={() => (
                  <Suspense fallback={<Loading />}>
                    <Home />
                  </Suspense>
                )}
              />
              <Route path="/:dir" component={DirectoryLayout}>
                <Route path="/" component={() => <Navigate href="session" />} />
                <Route
                  path="/session/:id?"
                  component={(p) => (
                    <Show when={p.params.id ?? "new"}>
                      <TerminalProvider>
                        <FileProvider>
                          <PromptProvider>
                            <CommentsProvider>
                              <Suspense fallback={<Loading />}>
                                <Session />
                              </Suspense>
                            </CommentsProvider>
                          </PromptProvider>
                        </FileProvider>
                      </TerminalProvider>
                    </Show>
                  )}
                />
              </Route>
            </Router>
          </GlobalSyncProvider>
        </GlobalSDKProvider>
      </ServerKey>
    </ServerProvider>
  )
}
