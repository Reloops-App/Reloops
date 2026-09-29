import { lazy, type ComponentType, type LazyExoticComponent } from "react";

type RouteModule<T extends ComponentType<any>> = {
  default: T;
};

type LazyRouteOptions = {
  retries?: number;
  retryDelayMs?: number;
};

const DEFAULT_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 250;

function sleep(ms: number) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

export function isRetriableLazyRouteError(error: unknown) {
  const message = String((error as { message?: unknown } | null)?.message ?? error).toLowerCase();
  return (
    message.includes("failed to fetch dynamically imported module") ||
    message.includes("error loading dynamically imported module") ||
    message.includes("importing a module script failed") ||
    message.includes("networkerror") ||
    message.includes("load failed") ||
    message.includes("connection reset")
  );
}

export async function loadRouteWithRetry<T extends ComponentType<any>>(
  loader: () => Promise<RouteModule<T>>,
  options: LazyRouteOptions = {},
): Promise<RouteModule<T>> {
  const retries = Math.max(0, options.retries ?? DEFAULT_RETRIES);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await loader();
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !isRetriableLazyRouteError(error)) throw error;
      await sleep(retryDelayMs * Math.max(1, attempt + 1));
    }
  }

  throw lastError;
}

export function lazyRoute<T extends ComponentType<any>>(
  loader: () => Promise<RouteModule<T>>,
  options?: LazyRouteOptions,
): LazyExoticComponent<T> {
  return lazy(() => loadRouteWithRetry(loader, options));
}

export function lazyNamedRoute<T extends ComponentType<any>, TModule extends Record<string, unknown>>(
  loader: () => Promise<TModule>,
  exportName: keyof TModule,
  options?: LazyRouteOptions,
): LazyExoticComponent<T> {
  return lazyRoute(
    async () => {
      const module = await loader();
      return { default: module[exportName] as T };
    },
    options,
  );
}
