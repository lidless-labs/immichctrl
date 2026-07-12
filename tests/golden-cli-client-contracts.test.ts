import { spawn } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { run, type CliDeps } from "../src/cli.js";

const sdkMock = vi.hoisted(() => {
  const calls: Array<{ fn: string; args: unknown[] }> = [];
  const makeFn = (fn: string, value: unknown = undefined) =>
    vi.fn((...args: unknown[]) => {
      calls.push({ fn, args });
      return Promise.resolve(value);
    });

  return {
    calls,
    init: vi.fn((...args: unknown[]) => {
      calls.push({ fn: "init", args });
    }),
    pingServer: makeFn("pingServer", { res: "pong" }),
    getServerConfig: makeFn("getServerConfig", {}),
    getServerStatistics: makeFn("getServerStatistics", {}),
    getServerFeatures: makeFn("getServerFeatures", {}),
    getStorage: makeFn("getStorage", {}),
    getAboutInfo: makeFn("getAboutInfo", {}),
    getServerVersion: makeFn("getServerVersion", {}),
    getAllAlbums: makeFn("getAllAlbums", []),
    getAlbumInfo: makeFn("getAlbumInfo", {}),
    getAlbumStatistics: makeFn("getAlbumStatistics", {}),
    searchAssets: makeFn("searchAssets", { assets: { items: [] } }),
    getAssetInfo: makeFn("getAssetInfo", {}),
    getAssetStatistics: makeFn("getAssetStatistics", {}),
    getAllPeople: makeFn("getAllPeople", { people: [] }),
    getAllTags: makeFn("getAllTags", []),
    getAssetDuplicates: makeFn("getAssetDuplicates", []),
    getQueuesLegacy: makeFn("getQueuesLegacy", {}),
    searchMemories: makeFn("searchMemories", []),
    searchSmart: makeFn("searchSmart", { assets: { items: [] } }),
  };
});

vi.mock("@immich/sdk", () => ({
  init: sdkMock.init,
  pingServer: sdkMock.pingServer,
  getServerConfig: sdkMock.getServerConfig,
  getServerStatistics: sdkMock.getServerStatistics,
  getServerFeatures: sdkMock.getServerFeatures,
  getStorage: sdkMock.getStorage,
  getAboutInfo: sdkMock.getAboutInfo,
  getServerVersion: sdkMock.getServerVersion,
  getAllAlbums: sdkMock.getAllAlbums,
  getAlbumInfo: sdkMock.getAlbumInfo,
  getAlbumStatistics: sdkMock.getAlbumStatistics,
  searchAssets: sdkMock.searchAssets,
  getAssetInfo: sdkMock.getAssetInfo,
  getAssetStatistics: sdkMock.getAssetStatistics,
  getAllPeople: sdkMock.getAllPeople,
  getAllTags: sdkMock.getAllTags,
  getAssetDuplicates: sdkMock.getAssetDuplicates,
  getQueuesLegacy: sdkMock.getQueuesLegacy,
  searchMemories: sdkMock.searchMemories,
  searchSmart: sdkMock.searchSmart,
}));

import { ImmichClient } from "../src/immich-client.js";

function deps(overrides: Partial<CliDeps> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const base: CliDeps = {
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    makeClient: () =>
      ({
        ping: vi.fn().mockResolvedValue({ res: "pong" }),
        serverStatistics: vi.fn().mockResolvedValue({ photos: 0, videos: 0 }),
      }) as unknown as ImmichClient,
    serve: vi.fn().mockResolvedValue(undefined),
  };
  return { out, err, deps: { ...base, ...overrides } };
}

function runEntrypoint(argv: string[], envOverrides: Record<string, string | undefined> = {}) {
  const env = { ...process.env };
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }

  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/cli.ts", ...argv], {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("golden programmatic CLI contracts", () => {
  it("rejects with the original construction error when makeClient fails", async () => {
    const constructionError = new Error("IMMICH_BASE_URL is required (e.g. https://photos.example.com/api)");
    const captured = deps({
      makeClient: () => {
        throw constructionError;
      },
    });

    await expect(run(["ping"], captured.deps)).rejects.toBe(constructionError);
    expect(captured.err).toEqual([]);
  });

  it("preserves the startup rejection object identity on the mcp path", async () => {
    const startupError = new Error("stdio refused");
    const captured = deps({
      serve: vi.fn().mockRejectedValue(startupError),
    });

    await expect(run(["mcp"], captured.deps)).rejects.toBe(startupError);
  });
});

describe("golden CLI exit and stderr contracts", () => {
  it("returns exit 2 and prints the current stderr for an unknown command", async () => {
    const captured = deps();

    await expect(run(["bogus"], captured.deps)).resolves.toBe(2);

    expect(captured.err[0]).toBe("Unknown command: bogus");
    expect(captured.err[1]).toBe("");
    expect(captured.err.join("\n")).toContain("Usage:");
  });

  it("returns exit 1 and prints the current stderr for a failed API call", async () => {
    const apiError = new Error("Immich server error 503: upstream unavailable");
    const client = {
      serverStatistics: vi.fn().mockRejectedValue(apiError),
    } as unknown as ImmichClient;
    const captured = deps({ makeClient: () => client });

    await expect(run(["server", "stats"], captured.deps)).resolves.toBe(1);

    expect(captured.err).toEqual(["Immich server error 503: upstream unavailable"]);
  });

  it("process entrypoint exits 1 and prints only the missing config message", async () => {
    const result = await runEntrypoint(["ping"], {
      IMMICH_BASE_URL: undefined,
      IMMICH_API_KEY: undefined,
    });

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("IMMICH_BASE_URL is required (e.g. https://photos.example.com/api)\n");
  });
});

describe("golden Immich SDK-owned auth and initialization contract", () => {
  it("initializes the Immich SDK with baseUrl and apiKey without raw fetch headers", async () => {
    sdkMock.calls.length = 0;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const client = new ImmichClient({
      baseUrl: "https://photos.example.com/api",
      apiKey: "secret-api-key",
      allowWrites: false,
      verifySsl: true,
    });
    await client.ping();

    expect(sdkMock.calls[0]).toEqual({
      fn: "init",
      args: [{ baseUrl: "https://photos.example.com/api", apiKey: "secret-api-key" }],
    });
    expect(sdkMock.calls[1]).toEqual({ fn: "pingServer", args: [] });
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
