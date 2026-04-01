/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GLITCHTIP_DSN: string;
  readonly VITE_GLITCHTIP_ENVIRONMENT: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.css' {
  const content: string;
  export default content;
}
