interface ImportMetaEnv {
  readonly VITE_HYSCIENCE_SERVER_HOST: string
  readonly VITE_HYSCIENCE_SERVER_PORT: string
  readonly VITE_HYSCIENCE_SERVER?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  __HYSCIENCE_BASE_URL__?: string
}
