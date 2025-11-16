import { describe, it, expect } from "vitest";
import {
  hasMaptilerKey,
  buildMaptilerStyleUrl,
  containsApiKey,
  extractMaptilerApiKey,
  buildFinalMaptilerStyleUrl,
} from "./maptilerRuntime";

describe("maptilerRuntime helpers", () => {
  describe("hasMaptilerKey", () => {
    it("detects key presence from secrets", () => {
      const cfg = {
        secrets: { maptiler: { api_key: "TESTKEY" } },
        ui_map: { maptiler: { styleUrl: "https://api.maptiler.com/maps/streets-v4/style.json" } },
      };
      expect(hasMaptilerKey(cfg, null)).toBe(true);
    });

    it("detects key presence from ui_map.maptiler.api_key", () => {
      const cfg = {
        ui_map: { maptiler: { api_key: "TESTKEY", styleUrl: "https://api.maptiler.com/maps/streets-v4/style.json" } },
      };
      expect(hasMaptilerKey(cfg, null)).toBe(true);
    });

    it("detects key presence from ui_map.maptiler.apiKey (legacy)", () => {
      const cfg = {
        ui_map: { maptiler: { apiKey: "TESTKEY", styleUrl: "https://api.maptiler.com/maps/streets-v4/style.json" } },
      };
      expect(hasMaptilerKey(cfg, null)).toBe(true);
    });

    it("detects key presence from health.has_api_key", () => {
      const cfg = { ui_map: { maptiler: { styleUrl: "https://api.maptiler.com/maps/streets-v4/style.json" } } };
      const health = {
        maptiler: { has_api_key: true, styleUrl: "https://api.maptiler.com/maps/streets-v4/style.json?key=TEST" },
      };
      expect(hasMaptilerKey(cfg, health)).toBe(true);
    });

    it("returns false when no key available", () => {
      const cfg = { ui_map: { maptiler: { styleUrl: "https://api.maptiler.com/maps/streets-v4/style.json" } } };
      const health = { maptiler: { has_api_key: false } };
      expect(hasMaptilerKey(cfg, health)).toBe(false);
    });
  });

  describe("extractMaptilerApiKey", () => {
    it("extracts key from secrets", () => {
      const cfg = { secrets: { maptiler: { api_key: "TESTKEY" } } };
      expect(extractMaptilerApiKey(cfg, null)).toBe("TESTKEY");
    });

    it("extracts key from ui_map.maptiler.api_key", () => {
      const cfg = { ui_map: { maptiler: { api_key: "TESTKEY" } } };
      expect(extractMaptilerApiKey(cfg, null)).toBe("TESTKEY");
    });

    it("extracts key from health.maptiler.styleUrl", () => {
      const health = {
        maptiler: { styleUrl: "https://api.maptiler.com/maps/streets-v4/style.json?key=HEALTHKEY" },
      };
      expect(extractMaptilerApiKey(null, health)).toBe("HEALTHKEY");
    });

    it("prioritizes secrets over ui_map", () => {
      const cfg = {
        secrets: { maptiler: { api_key: "SECRETKEY" } },
        ui_map: { maptiler: { api_key: "UIMAPKEY" } },
      };
      expect(extractMaptilerApiKey(cfg, null)).toBe("SECRETKEY");
    });

    it("returns null when no key available", () => {
      const cfg = { ui_map: { maptiler: { styleUrl: "https://api.maptiler.com/maps/streets-v4/style.json" } } };
      expect(extractMaptilerApiKey(cfg, null)).toBeNull();
    });
  });

  describe("buildMaptilerStyleUrl", () => {
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
      expect(out).not.toContain("key=TESTKEY");
    });

    it("returns URL without key when no apiKey provided", () => {
      const base = "https://api.maptiler.com/maps/streets-v4/style.json";
      const out = buildMaptilerStyleUrl(base, null);
      expect(out).toBe(base);
      expect(containsApiKey(out)).toBe(false);
    });

    it("handles URL with existing query params", () => {
      const base = "https://api.maptiler.com/maps/streets-v4/style.json?v=1";
      const out = buildMaptilerStyleUrl(base, "TESTKEY");
      expect(out).toContain("v=1");
      expect(out).toContain("key=TESTKEY");
    });
  });

  describe("buildFinalMaptilerStyleUrl", () => {
    it("Caso A: config tiene styleUrl sin key y secrets.maptiler.api_key", () => {
      const cfg = {
        secrets: { maptiler: { api_key: "TEST" } },
        ui_map: {
          maptiler: { styleUrl: "https://api.maptiler.com/maps/streets-v4/style.json" },
        },
      };
      const health = { maptiler: { has_api_key: false } };
      const baseStyleUrl = "https://api.maptiler.com/maps/streets-v4/style.json";

      const result = buildFinalMaptilerStyleUrl(cfg, health, baseStyleUrl);
      expect(result).toContain("key=TEST");
      expect(containsApiKey(result)).toBe(true);
      expect(hasMaptilerKey(cfg, health)).toBe(true);
    });

    it("Caso B: health.maptiler.styleUrl viene ya con ?key=HEALTH", () => {
      const cfg = {
        ui_map: {
          maptiler: { styleUrl: "https://api.maptiler.com/maps/streets-v4/style.json" },
        },
      };
      const health = {
        maptiler: {
          has_api_key: true,
          styleUrl: "https://api.maptiler.com/maps/streets-v4/style.json?key=HEALTH",
        },
      };
      const baseStyleUrl = "https://api.maptiler.com/maps/streets-v4/style.json";

      const result = buildFinalMaptilerStyleUrl(cfg, health, baseStyleUrl);
      expect(result).toBe("https://api.maptiler.com/maps/streets-v4/style.json?key=HEALTH");
      expect(hasMaptilerKey(cfg, health)).toBe(true);
    });

    it("Caso C: no hay ninguna key en config ni en health", () => {
      const cfg = {
        ui_map: {
          maptiler: { styleUrl: "https://api.maptiler.com/maps/streets-v4/style.json" },
        },
      };
      const health = { maptiler: { has_api_key: false } };
      const baseStyleUrl = "https://api.maptiler.com/maps/streets-v4/style.json";

      const result = buildFinalMaptilerStyleUrl(cfg, health, baseStyleUrl);
      expect(result).toBe("https://api.maptiler.com/maps/streets-v4/style.json");
      expect(containsApiKey(result)).toBe(false);
      expect(hasMaptilerKey(cfg, health)).toBe(false);
    });

    it("prioritizes health.styleUrl over baseStyleUrl", () => {
      const cfg = {
        secrets: { maptiler: { api_key: "CONFIGKEY" } },
        ui_map: {
          maptiler: { styleUrl: "https://api.maptiler.com/maps/streets-v4/style.json" },
        },
      };
      const health = {
        maptiler: {
          has_api_key: true,
          styleUrl: "https://api.maptiler.com/maps/streets-v4/style.json?key=HEALTHKEY",
        },
      };
      const baseStyleUrl = "https://api.maptiler.com/maps/streets-v4/style.json";

      const result = buildFinalMaptilerStyleUrl(cfg, health, baseStyleUrl);
      expect(result).toBe("https://api.maptiler.com/maps/streets-v4/style.json?key=HEALTHKEY");
    });
  });

  describe("containsApiKey", () => {
    it("detects ?key= pattern", () => {
      expect(containsApiKey("https://api.maptiler.com/maps/streets-v4/style.json?key=TEST")).toBe(true);
    });

    it("detects &key= pattern", () => {
      expect(containsApiKey("https://api.maptiler.com/maps/streets-v4/style.json?v=1&key=TEST")).toBe(true);
    });

    it("returns false when no key", () => {
      expect(containsApiKey("https://api.maptiler.com/maps/streets-v4/style.json")).toBe(false);
    });

    it("returns false for null/undefined", () => {
      expect(containsApiKey(null)).toBe(false);
      expect(containsApiKey(undefined)).toBe(false);
    });
  });
});

