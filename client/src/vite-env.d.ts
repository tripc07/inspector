/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OAUTH_CLIENT_URI?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
