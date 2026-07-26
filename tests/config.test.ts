import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("normalizeBaseUrl", () => {
  it("appends /api when missing", async () => {
    const { normalizeBaseUrl } = await import("../src/config.js");
    expect(normalizeBaseUrl("https://photos.example.com")).toBe(
      "https://photos.example.com/api",
    );
  });

  it("removes trailing slash before appending /api", async () => {
    const { normalizeBaseUrl } = await import("../src/config.js");
    expect(normalizeBaseUrl("https://photos.example.com/")).toBe(
      "https://photos.example.com/api",
    );
  });

  it("leaves /api intact when already present", async () => {
    const { normalizeBaseUrl } = await import("../src/config.js");
    expect(normalizeBaseUrl("https://photos.example.com/api")).toBe(
      "https://photos.example.com/api",
    );
  });

  it("handles /api/ with trailing slash", async () => {
    const { normalizeBaseUrl } = await import("../src/config.js");
    expect(normalizeBaseUrl("https://photos.example.com/api/")).toBe(
      "https://photos.example.com/api",
    );
  });

  it("handles localhost with port", async () => {
    const { normalizeBaseUrl } = await import("../src/config.js");
    expect(normalizeBaseUrl("http://localhost:2283")).toBe(
      "http://localhost:2283/api",
    );
  });

  it("handles localhost with port and existing /api", async () => {
    const { normalizeBaseUrl } = await import("../src/config.js");
    expect(normalizeBaseUrl("http://localhost:2283/api")).toBe(
      "http://localhost:2283/api",
    );
  });
});

describe("getConfig", () => {
  const ORIGINAL = { ...process.env };

  beforeEach(() => {
    process.env = { ...ORIGINAL };
  });

  afterEach(() => {
    process.env = ORIGINAL;
  });

  it("parses required vars", async () => {
    process.env.IMMICH_BASE_URL = "https://photos.example.com/api";
    process.env.IMMICH_API_KEY = "test-key";
    const { getConfig } = await import("../src/config.js");
    const cfg = getConfig();
    expect(cfg.baseUrl).toBe("https://photos.example.com/api");
    expect(cfg.apiKey).toBe("test-key");
    expect(cfg.allowWrites).toBe(false);
    expect(cfg.verifySsl).toBe(true);
  });

  it("throws when IMMICH_BASE_URL is missing", async () => {
    delete process.env.IMMICH_BASE_URL;
    process.env.IMMICH_API_KEY = "test-key";
    const { getConfig } = await import("../src/config.js");
    expect(() => getConfig()).toThrow(/IMMICH_BASE_URL/);
  });

  it("throws when IMMICH_API_KEY is missing", async () => {
    process.env.IMMICH_BASE_URL = "https://photos.example.com/api";
    delete process.env.IMMICH_API_KEY;
    const { getConfig } = await import("../src/config.js");
    expect(() => getConfig()).toThrow(/IMMICH_API_KEY/);
  });

  it("toggles allowWrites via env", async () => {
    process.env.IMMICH_BASE_URL = "https://photos.example.com/api";
    process.env.IMMICH_API_KEY = "test-key";
    process.env.IMMICH_ALLOW_WRITES = "true";
    const { getConfig } = await import("../src/config.js");
    expect(getConfig().allowWrites).toBe(true);
  });

  it("toggles verifySsl via env", async () => {
    process.env.IMMICH_BASE_URL = "https://photos.example.com/api";
    process.env.IMMICH_API_KEY = "test-key";
    process.env.IMMICH_VERIFY_SSL = "false";
    const { getConfig } = await import("../src/config.js");
    expect(getConfig().verifySsl).toBe(false);
  });
});
