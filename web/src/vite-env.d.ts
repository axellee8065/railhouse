/// <reference types="vite/client" />
/// <reference types="msw/vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string
  readonly VITE_FORCE_MSW: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
