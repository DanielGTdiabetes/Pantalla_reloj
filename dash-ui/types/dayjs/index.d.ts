declare module "dayjs" {
  type ConfigType = string | number | Date | null | undefined | Dayjs;
  interface Dayjs {
    format(fmt?: string): string;
    tz(timezone?: string): Dayjs;
    locale(locale: string): Dayjs;
    toDate(): Date;
  }
  interface PluginFunc {
    (option?: unknown, dayjsClass?: unknown, dayjsFactory?: unknown): void;
  }
  interface DayjsFactory {
    (config?: ConfigType): Dayjs;
    extend(plugin: PluginFunc, option?: unknown): void;
    locale(locale: string): void;
  }
  const dayjs: DayjsFactory;
  export default dayjs;
}

declare module "dayjs/plugin/utc" {
  import type { PluginFunc } from "dayjs";
  const plugin: PluginFunc;
  export default plugin;
}

declare module "dayjs/plugin/timezone" {
  import type { PluginFunc } from "dayjs";
  const plugin: PluginFunc;
  export default plugin;
}

declare module "dayjs/locale/es" {
  const locale: unknown;
  export default locale;
}
