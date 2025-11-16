import { describe, it, expect } from "vitest";
import { hasMaptilerKey, buildMaptilerStyleUrl, containsApiKey } from "./maptilerRuntime";

describe("maptilerRuntime helpers", () => {
  it("detects key presence from secrets", () => {
    const cfg = { secrets: { maptiler: { api_key: "TESTKEY" } }, ui_map: { maptiler: { styleUrl: "https://api.maptiler.com/maps/streets-v4/style.json" } } };
    expect(hasMaptilerKey(cfg, null)).toBe(true);
  });

  it("detects key presence from health", () => {
    const cfg = { ui_map: { maptiler: { styleUrl: "https://api.maptiler.com/maps/streets-v4/style.json" } } };
    const health = { maptiler: { has_api_key: true, styleUrl: "https://api.maptiler.com/maps/streets-v4/style.json?key=TEST" } };
    expect(hasMaptilerKey(cfg, health)).toBe(true);
  });

  it("builds signed URL when apiKey provided", () => {
    const base = "https://api.maptiler.com/maps/streets-v4/style.json";
    const out = buildMaptilerStyleUrl(base, "TESTKEY");
    expect(out).toContain("key=TESTKEY");
    expect(containsApiKey(out)).toBe(true);
  });

  it("keeps existing key untouched", () => {
    const base = "https://api.maptiler.com/maps/streets-v4/style.json?key=EXISTING";
    const out = buildMaptilerStyleUrl(base, "TESTKEY");
    expect(out).toContain("key=EXISTING");
  });
});

