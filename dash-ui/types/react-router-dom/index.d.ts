declare module "react-router-dom" {
  export interface RouteObject {
    path?: string;
    element?: any;
    children?: RouteObject[];
  }
  export const BrowserRouter: (props: { children?: any }) => any;
  export const Routes: (props: { children?: any }) => any;
  export const Route: (props: { path?: string; element?: any }) => any;
  export function useNavigate(): (path: string) => void;
  export function useParams<T extends Record<string, string | undefined> = Record<string, string | undefined>>(): T;
  export function Link(props: { to: string; children?: any }): any;
  export function NavLink(props: { to: string; children?: any }): any;
  export function createBrowserRouter(routes: RouteObject[]): any;
  export function RouterProvider(props: { router: any }): any;
}
