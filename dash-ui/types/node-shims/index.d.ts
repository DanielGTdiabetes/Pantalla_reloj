// Minimal Node.js type shims to satisfy the TypeScript compiler when the real
// `@types/node` package is unavailable in the deployment environment.
declare const Buffer: {
  from: (...args: unknown[]) => unknown;
  isBuffer: (value: unknown) => boolean;
  byteLength: (...args: unknown[]) => number;
};

type Buffer = unknown;

declare namespace NodeJS {
  interface EventEmitter {}
  interface Timeout {}
}

declare module "node:events" {
  export class EventEmitter implements NodeJS.EventEmitter {
    on: (...args: unknown[]) => this;
    off: (...args: unknown[]) => this;
    once: (...args: unknown[]) => this;
    emit: (...args: unknown[]) => boolean;
  }
}

declare module "node:http" {
  export type OutgoingHttpHeaders = Record<string, string>;
  export type ClientRequestArgs = Record<string, unknown>;
  export type IncomingMessage = unknown;
  export type ClientRequest = unknown;
  export type Agent = unknown;
  export type Server = unknown;
  export type ServerResponse = unknown;
  const http: unknown;
  export = http;
}

declare module "node:http2" {
  export type Http2SecureServer = unknown;
}

declare module "node:https" {
  export type ServerOptions = Record<string, unknown>;
  export type Server = unknown;
}

declare module "node:fs" {
  const fs: unknown;
  export = fs;
}

declare module "node:net" {
  const net: unknown;
  export = net;
}

declare module "node:url" {
  export class URL {}
  const url: unknown;
  export = url;
}

declare module "node:stream" {
  export type Duplex = unknown;
  export type DuplexOptions = Record<string, unknown>;
}

declare module "node:tls" {
  export type SecureContextOptions = Record<string, unknown>;
}

declare module "node:zlib" {
  export type ZlibOptions = Record<string, unknown>;
}

declare module "node:buffer" {
  export const Buffer: typeof globalThis extends { Buffer: infer T } ? T : never;
}

declare module "rollup/parseAst" {
  export const parseAst: (...args: unknown[]) => unknown;
  export const parseAstAsync: (...args: unknown[]) => Promise<unknown>;
}
