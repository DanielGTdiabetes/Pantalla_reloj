declare module "vitest" {
  export type Mock<T extends (...args: any[]) => any = (...args: any[]) => any> = T & {
    mockImplementation(fn: T): Mock<T>;
    mockImplementationOnce(fn: T): Mock<T>;
    mockReturnValue(value: ReturnType<T>): Mock<T>;
    mockReturnValueOnce(value: ReturnType<T>): Mock<T>;
    mockResolvedValue(value: unknown): Mock<T>;
    mockRejectedValue(value: unknown): Mock<T>;
    mockClear(): void;
    mockReset(): void;
    mockRestore(): void;
    calls: unknown[];
  };
  export const describe: (name: string, fn: () => void | Promise<void>) => void;
  export const it: (name: string, fn: () => void | Promise<void>) => void;
  export const test: typeof it;
  export const beforeEach: (fn: () => void | Promise<void>) => void;
  export const afterEach: (fn: () => void | Promise<void>) => void;
  export const expect: any;
  export const vi: {
    fn<T extends (...args: any[]) => any>(impl?: T): Mock<T>;
    spyOn<T extends object, M extends keyof T>(obj: T, method: M): Mock<T[M]>;
    mock(moduleName: string, factory?: (...args: any[]) => unknown): void;
    mocked<T>(item: T, options?: { shallow?: boolean }): T;
    useFakeTimers(): void;
    useRealTimers(): void;
    isFakeTimers(): boolean;
    runOnlyPendingTimers(): void;
    advanceTimersByTime(ms: number): void;
    stubGlobal(name: string, value: unknown): void;
    unstubAllGlobals(): void;
    setSystemTime(time: unknown): void;
    clearAllMocks(): void;
    resetAllMocks(): void;
    restoreAllMocks(): void;
  };
}
