declare module "@testing-library/user-event" {
  interface SetupOptions {
    delay?: number;
  }
  interface UserEventInstance {
    click(target: Element | Node | null, options?: Record<string, unknown>): Promise<void>;
    type(target: Element | Node | null, text: string, options?: Record<string, unknown>): Promise<void>;
    clear(target: Element | Node | null): Promise<void>;
    hover(target: Element | Node | null): Promise<void>;
    unhover(target: Element | Node | null): Promise<void>;
  }
  interface UserEvent {
    click(target: Element | Node | null, options?: Record<string, unknown>): Promise<void>;
    type(target: Element | Node | null, text: string, options?: Record<string, unknown>): Promise<void>;
    clear(target: Element | Node | null): Promise<void>;
    hover(target: Element | Node | null): Promise<void>;
    unhover(target: Element | Node | null): Promise<void>;
    setup(options?: SetupOptions): UserEventInstance;
  }
  const userEvent: UserEvent;
  export default userEvent;
}
