declare module "vite/client" {
  interface ImportMetaEnv {
    [key: string]: string | undefined;
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv;
    url: string;
  }
  const env: ImportMetaEnv;
  export { env };
}
