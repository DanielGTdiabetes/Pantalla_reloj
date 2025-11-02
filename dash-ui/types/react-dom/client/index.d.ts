declare module "react-dom/client" {
  export interface Root {
    render(children: any): void;
    unmount(): void;
  }
  export function createRoot(container: any): Root;
  export function hydrateRoot(container: any, initialChildren: any): Root;
}
