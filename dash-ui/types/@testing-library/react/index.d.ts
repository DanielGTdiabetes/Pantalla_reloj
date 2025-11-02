declare module "@testing-library/react" {
  export interface RenderResult {
    container: HTMLElement;
    baseElement: HTMLElement;
    debug: (...args: unknown[]) => void;
    rerender: (ui: any) => void;
    unmount: () => void;
  }
  export function render(ui: any, options?: Record<string, unknown>): RenderResult;
  export const screen: Record<string, (...args: any[]) => any> & {
    getByText: (...args: any[]) => HTMLElement;
  };
  export function waitFor<T>(callback: () => T | Promise<T>, options?: Record<string, unknown>): Promise<T>;
}
