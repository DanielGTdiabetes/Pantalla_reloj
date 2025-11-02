declare module "@vitejs/plugin-react" {
  interface ReactPluginOptions {
    jsxImportSource?: string;
    include?: string | string[];
    exclude?: string | string[];
  }
  export default function reactPlugin(options?: ReactPluginOptions): unknown;
}
