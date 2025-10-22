/// <reference types="vite/client" />

declare module '*.webp' {
  const src: string;
  export default src;
}

declare module '*.wav' {
  const src: string;
  export default src;
}

declare module '*.mp3' {
  const src: string;
  export default src;
}

interface ImportMetaEnv {
  readonly VITE_ENABLE_WEBGL?: string;
  readonly VITE_ENABLE_LOTTIE?: string;
  readonly VITE_ENABLE_FPSMETER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
