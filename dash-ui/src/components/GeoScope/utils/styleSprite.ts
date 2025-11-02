import type { StyleSpecification } from "maplibre-gl";

const spriteAvailabilityCache = new Map<string, Promise<boolean>>();

const resolveSpriteJsonUrl = (sprite: string): string => {
  const trimmed = sprite.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }
  const [base, query] = trimmed.split("?");
  const suffix = query ? `?${query}` : "";
  if (/\.json$/i.test(base)) {
    return trimmed;
  }
  if (/\.png$/i.test(base)) {
    return `${base.replace(/\.png$/i, ".json")}${suffix}`;
  }
  return `${base}.json${suffix}`;
};

const requestWithTimeout = async (
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response | null> => {
  if (typeof fetch !== "function") {
    return null;
  }
  const controller = typeof AbortController !== "undefined" ? new AbortController() : undefined;
  const signal = controller?.signal;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(url, { ...init, signal });
    return response;
  } catch (error) {
    if ((error as DOMException)?.name === "AbortError") {
      return null;
    }
    return null;
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
};

const verifySprite = async (spriteUrl: string): Promise<boolean> => {
  const jsonUrl = resolveSpriteJsonUrl(spriteUrl);
  if (!jsonUrl) {
    return false;
  }
  const headResponse = await requestWithTimeout(jsonUrl, { method: "HEAD" }, 800);
  if (headResponse?.ok) {
    return true;
  }
  if (headResponse && (headResponse.status === 405 || headResponse.status === 403)) {
    const getResponse = await requestWithTimeout(jsonUrl, { method: "GET" }, 800);
    return Boolean(getResponse?.ok);
  }
  if (!headResponse || headResponse.status === 404 || headResponse.status === 401) {
    return false;
  }
  const getFallback = await requestWithTimeout(jsonUrl, { method: "GET" }, 800);
  return Boolean(getFallback?.ok);
};

export const hasSprite = async (style: StyleSpecification | undefined | null): Promise<boolean> => {
  if (!style || typeof style !== "object") {
    return false;
  }
  const spriteCandidate = (style as { sprite?: unknown }).sprite;
  if (typeof spriteCandidate !== "string") {
    return false;
  }
  const spriteUrl = spriteCandidate.trim();
  if (!spriteUrl) {
    return false;
  }
  if (!spriteAvailabilityCache.has(spriteUrl)) {
    spriteAvailabilityCache.set(spriteUrl, verifySprite(spriteUrl));
  }
  try {
    return await spriteAvailabilityCache.get(spriteUrl)!;
  } catch {
    return false;
  }
};
