declare module "react-dom" {
  export function render(element: any, container: any): void;
  export function createPortal(children: any, container: any): any;
  export const version: string;
  const ReactDOM: {
    render: typeof render;
    createPortal: typeof createPortal;
    version: string;
  };
  export default ReactDOM;
}
