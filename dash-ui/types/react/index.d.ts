// Minimal React type shims for offline builds.
declare module "react" {
  export type ReactNode = unknown;
  export type Key = string | number;
  export type SetStateAction<S> = S | ((prevState: S) => S);
  export type Dispatch<A> = (value: A) => void;
  export interface MutableRefObject<T> {
    current: T;
  }
  export interface Context<T> {
    Provider: (props: { value: T; children?: ReactNode }) => ReactNode;
    Consumer: (props: { children?: ReactNode }) => ReactNode;
    displayName?: string;
  }
  export interface FC<P = {}> {
    (props: P & { children?: ReactNode }): ReactNode;
    displayName?: string;
    defaultProps?: Partial<P>;
  }
  export interface PropsWithChildren<P = {}> extends P {
    children?: ReactNode;
  }
  export interface FunctionComponent<P = {}> extends FC<P> {}
  export type ComponentType<P = {}> = FC<P> | ComponentClass<P>;
  export interface ComponentClass<P = {}, S = {}> {
    new (props: P, context?: unknown): Component<P, S>;
    displayName?: string;
    defaultProps?: Partial<P>;
  }
  export class Component<P = {}, S = {}> {
    constructor(props: P, context?: unknown);
    setState(state: Partial<S> | ((prev: S) => Partial<S> | null) | null): void;
    forceUpdate(): void;
    render(): ReactNode;
    props: Readonly<P> & Readonly<{ children?: ReactNode }>;
    state: Readonly<S>;
    context: unknown;
  }
  export interface ErrorInfo {
    componentStack: string;
  }
  export interface ExoticComponent<P = {}> {
    (props: P): ReactNode;
    readonly $$typeof: symbol;
  }
  export type Ref<T> = MutableRefObject<T> | ((instance: T | null) => void) | null;
  export type RefCallback<T> = (instance: T | null) => void;
  export interface SyntheticEvent<T = Element, E = Event> {
    nativeEvent: E;
    target: T;
    currentTarget: T;
    preventDefault(): void;
    stopPropagation(): void;
  }
  export function createElement(type: any, props?: any, ...children: ReactNode[]): ReactNode;
  export function cloneElement(element: ReactNode, props?: any, ...children: ReactNode[]): ReactNode;
  export function createContext<T>(defaultValue: T): Context<T>;
  export function useContext<T>(context: Context<T>): T;
  export function useState<S>(initial: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  export function useReducer<R extends (state: any, action: any) => any, I>(reducer: R, initialArg: I, init?: (arg: I) => any): [any, Dispatch<any>];
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useLayoutEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useMemo<T>(factory: () => T, deps?: readonly unknown[]): T;
  export function useCallback<T extends (...args: any[]) => any>(callback: T, deps?: readonly unknown[]): T;
  export function useRef<T>(initialValue: T | null): MutableRefObject<T | null>;
  export function useImperativeHandle<T, R extends T>(ref: Ref<T>, init: () => R, deps?: readonly unknown[]): void;
  export function useDebugValue<T>(value: T, format?: (value: T) => unknown): void;
  export function useTransition(): [boolean, (callback: () => void) => void];
  export function useDeferredValue<T>(value: T): T;
  export function useId(): string;
  export function startTransition(callback: () => void): void;
  export function forwardRef<T, P = {}>(render: (props: P, ref: Ref<T>) => ReactNode): (props: P & { ref?: Ref<T> }) => ReactNode;
  export function memo<T extends ComponentType<any>>(component: T, propsAreEqual?: (prevProps: any, nextProps: any) => boolean): T;
  export const Fragment: unique symbol;
  export const StrictMode: unique symbol;
  export const Suspense: unique symbol;
  export const Children: {
    map(children: ReactNode, fn: (child: ReactNode, index: number) => ReactNode): ReactNode[];
    forEach(children: ReactNode, fn: (child: ReactNode, index: number) => void): void;
    count(children: ReactNode): number;
    only(children: ReactNode): ReactNode;
    toArray(children: ReactNode): ReactNode[];
  };
  const React: {
    createElement: typeof createElement;
    cloneElement: typeof cloneElement;
    createContext: typeof createContext;
    useContext: typeof useContext;
    useState: typeof useState;
    useReducer: typeof useReducer;
    useEffect: typeof useEffect;
    useLayoutEffect: typeof useLayoutEffect;
    useMemo: typeof useMemo;
    useCallback: typeof useCallback;
    useRef: typeof useRef;
    useImperativeHandle: typeof useImperativeHandle;
    useDebugValue: typeof useDebugValue;
    useTransition: typeof useTransition;
    useDeferredValue: typeof useDeferredValue;
    useId: typeof useId;
    startTransition: typeof startTransition;
    forwardRef: typeof forwardRef;
    memo: typeof memo;
    Fragment: typeof Fragment;
    StrictMode: typeof StrictMode;
    Suspense: typeof Suspense;
    Children: typeof Children;
  };
  export default React;
}

declare module "react/jsx-runtime" {
  export const jsx: any;
  export const jsxs: any;
  export const Fragment: any;
}

declare module "react/jsx-dev-runtime" {
  export const jsxDEV: any;
  export const Fragment: any;
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      [elemName: string]: any;
    }
  }
}
