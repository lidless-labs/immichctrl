import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("getConfig", () => {
  const ORIGINAL = { ...process.env };

  beforeEach(() => {
    process.env = { ...ORIGINAL };
    delete process.env.IMMICH_UPLOAD_BASE_DIR;
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

  it("reads IMMICH_CA_CERT and leaves it unset by default", async () => {
    process.env.IMMICH_BASE_URL = "https://photos.example.com/api";
    process.env.IMMICH_API_KEY = "test-key";
    delete process.env.IMMICH_CA_CERT;
    const { getConfig } = await import("../src/config.js");
    expect(getConfig().caCertPath).toBeUndefined();
    process.env.IMMICH_CA_CERT = "/etc/immich/ca.pem";
    expect(getConfig().caCertPath).toBe("/etc/immich/ca.pem");
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

describe("upload base directory config", () => {
  let dir: string;
  const original = { ...process.env };
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "immich-config-"));
    process.env = { ...original, IMMICH_BASE_URL: "https://photos.example.com/api", IMMICH_API_KEY: "test-key" };
  });
  afterEach(() => {
    process.env = original;
    rmSync(dir, { recursive: true, force: true });
  });

  it("rejects a relative upload root", async () => {
    process.env.IMMICH_UPLOAD_BASE_DIR = "relative/uploads";
    const { getConfig } = await import("../src/config.js");
    expect(() => getConfig()).toThrow(/IMMICH_UPLOAD_BASE_DIR.*absolute/);
  });

  it("rejects a missing upload root clearly", async () => {
    process.env.IMMICH_UPLOAD_BASE_DIR = path.join(dir, "missing");
    const { getConfig } = await import("../src/config.js");
    expect(() => getConfig()).toThrow(/IMMICH_UPLOAD_BASE_DIR.*existing directory/);
  });

  it("rejects a file as upload root", async () => {
    const file = path.join(dir, "file");
    writeFileSync(file, "data");
    process.env.IMMICH_UPLOAD_BASE_DIR = file;
    const { getConfig } = await import("../src/config.js");
    expect(() => getConfig()).toThrow(/IMMICH_UPLOAD_BASE_DIR.*directory/);
  });

  it("resolves a symlinked upload root at startup", async () => {
    const root = path.join(dir, "root");
    mkdirSync(root);
    const link = path.join(dir, "link");
    symlinkSync(root, link);
    process.env.IMMICH_UPLOAD_BASE_DIR = link;
    const { getConfig } = await import("../src/config.js");
    expect(getConfig()).toHaveProperty("uploadBaseDir", realpathSync(root));
  });
});
