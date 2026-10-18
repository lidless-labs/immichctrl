import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { installFakeSdk, resetFakeSdk, sdkCalls, mockSdkResponse } from "./_fake-sdk.js";

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Config } from "../src/config.js";

installFakeSdk();

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAssetTools } from "../src/tools/assets.js";

const cfgRead = { baseUrl: "https://x/api", apiKey: "k", allowWrites: false, verifySsl: true };
const cfgWrite = { ...cfgRead, allowWrites: true };

async function callTool(server: McpServer, name: string, args: Record<string, unknown> = {}) {
  const reg = (server as unknown as { _registeredTools: Record<string, { handler: (a: unknown, extra?: unknown) => Promise<unknown> }> })._registeredTools;
  const tool = reg[name];
  if (!tool) throw new Error(`tool ${name} not registered`);
  return tool.handler(args, {});
}

describe("asset tools - reads", () => {
  let server: McpServer;
  beforeEach(() => {
    resetFakeSdk();
    server = new McpServer({ name: "immich-mcp", version: "0.0.0-test" });
    registerAssetTools(server, cfgRead);
  });

  it("immich_list_assets calls searchAssets", async () => {
    mockSdkResponse("searchAssets", { assets: { items: [] } });
    await callTool(server, "immich_list_assets", { isFavorite: true });
    const call = sdkCalls.find((c) => c.fn === "searchAssets");
    expect(call).toBeTruthy();
  });

  it("immich_get_asset calls getAssetInfo", async () => {
    mockSdkResponse("getAssetInfo", { id: "abc" });
    await callTool(server, "immich_get_asset", { id: "00000000-0000-0000-0000-000000000001" });
    expect(sdkCalls[0]?.fn).toBe("getAssetInfo");
  });

  it("immich_get_asset_exif returns exifInfo subset", async () => {
    mockSdkResponse("getAssetInfo", { id: "abc", exifInfo: { make: "Sony" } });
    const out = await callTool(server, "immich_get_asset_exif", { id: "00000000-0000-0000-0000-000000000001" }) as { content: { text: string }[] };
    expect(out.content[0]!.text).toContain("Sony");
  });

  it("immich_download_asset_original returns SDK-computed URL", async () => {
    mockSdkResponse("getAssetOriginalPath", "/api/asset/00000000-0000-0000-0000-000000000001/original");
    const out = await callTool(server, "immich_download_asset_original", { id: "00000000-0000-0000-0000-000000000001" }) as { content: { text: string }[] };
    expect(out.content[0]!.text).toContain("/original");
  });

  it("immich_get_asset_statistics calls getAssetStatistics", async () => {
    mockSdkResponse("getAssetStatistics", { videos: 0, images: 0 });
    await callTool(server, "immich_get_asset_statistics");
    expect(sdkCalls[0]?.fn).toBe("getAssetStatistics");
  });
});

describe("asset tools - write gate", () => {
  let server: McpServer;
  beforeEach(() => {
    resetFakeSdk();
    server = new McpServer({ name: "immich-mcp", version: "0.0.0-test" });
    registerAssetTools(server, cfgRead); // writes disabled
  });

  it("immich_update_asset refuses without writes enabled", async () => {
    const out = await callTool(server, "immich_update_asset", {
      id: "00000000-0000-0000-0000-000000000001",
      isFavorite: true,
    }) as { isError?: boolean; content: { text: string }[] };
    expect(out.isError).toBe(true);
    expect(out.content[0]!.text).toMatch(/Writes disabled/);
  });

  it("immich_delete_asset refuses without writes enabled", async () => {
    const out = await callTool(server, "immich_delete_asset", {
      ids: ["00000000-0000-0000-0000-000000000001"],
    }) as { isError?: boolean; content: { text: string }[] };
    expect(out.isError).toBe(true);
    expect(out.content[0]!.text).toMatch(/Writes disabled/);
  });
});

describe("asset tools - confirm gate", () => {
  let server: McpServer;
  beforeEach(() => {
    resetFakeSdk();
    server = new McpServer({ name: "immich-mcp", version: "0.0.0-test" });
    registerAssetTools(server, cfgWrite); // writes enabled
  });

  it("immich_bulk_update_assets refuses without confirm", async () => {
    const out = await callTool(server, "immich_bulk_update_assets", {
      ids: ["00000000-0000-0000-0000-000000000001"],
      isFavorite: true,
    }) as { isError?: boolean; content: { text: string }[] };
    expect(out.isError).toBe(true);
    expect(out.content[0]!.text).toMatch(/confirm: true/);
  });

  it("immich_delete_asset permanent: true refuses without confirm", async () => {
    const out = await callTool(server, "immich_delete_asset", {
      ids: ["00000000-0000-0000-0000-000000000001"],
      permanent: true,
    }) as { isError?: boolean; content: { text: string }[] };
    expect(out.isError).toBe(true);
    expect(out.content[0]!.text).toMatch(/confirm: true/);
  });

  it("immich_delete_asset trash (default) needs writes, no confirm", async () => {
    mockSdkResponse("deleteAssets", undefined);
    const out = await callTool(server, "immich_delete_asset", {
      ids: ["00000000-0000-0000-0000-000000000001"],
    }) as { isError?: boolean };
    expect(out.isError).toBeFalsy();
    expect(sdkCalls[0]?.fn).toBe("deleteAssets");
  });

  it("immich_bulk_update_assets with confirm: true proceeds", async () => {
    mockSdkResponse("updateAssets", undefined);
    const out = await callTool(server, "immich_bulk_update_assets", {
      ids: ["00000000-0000-0000-0000-000000000001"],
      isFavorite: true,
      confirm: true,
    }) as { isError?: boolean };
    expect(out.isError).toBeFalsy();
    expect(sdkCalls[0]?.fn).toBe("updateAssets");
  });
});

describe("path upload confinement", () => {
  let dir: string;
  let root: string;
  let inside: string;
  let outside: string;

  beforeEach(async () => {
    resetFakeSdk();
    dir = await fs.mkdtemp(path.join(tmpdir(), "immich-upload-"));
    root = path.join(dir, "root");
    await fs.mkdir(root);
    await fs.mkdir(`${root}-evil`);
    inside = path.join(root, "photo.jpg");
    outside = path.join(dir, "private.txt");
    await fs.writeFile(inside, "photo bytes");
    await fs.writeFile(outside, "private bytes");
    await fs.writeFile(path.join(`${root}-evil`, "photo.jpg"), "sibling bytes");
    await fs.symlink(outside, path.join(root, "link.jpg"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function upload(filePath: string, overrides: Partial<Config> = {}) {
    const server = new McpServer({ name: "test", version: "0" });
    registerAssetTools(server, { ...cfgWrite, uploadBaseDir: root, ...overrides } as Config);
    return await callTool(server, "immich_upload_asset_from_path", { filePath, deviceId: "test" }) as {
      isError?: boolean; content: { text: string }[];
    };
  }

  it("refuses an unset root before any filesystem access", async () => {
    const realpath = vi.spyOn(fs, "realpath");
    const open = vi.spyOn(fs, "open");
    const readFile = vi.spyOn(fs, "readFile");
    const stat = vi.spyOn(fs, "stat");
    const out = await upload(inside, { uploadBaseDir: undefined });
    expect(out.isError).toBe(true);
    expect(out.content[0]!.text).toMatch(/IMMICH_UPLOAD_BASE_DIR/);
    for (const spy of [realpath, open, readFile, stat]) expect(spy).not.toHaveBeenCalled();
    expect(sdkCalls).toHaveLength(0);
  });

  it.each(["outside", "dot-dot", "symlink", "sibling-prefix"])("refuses %s escape", async (kind) => {
    const target = {
      outside,
      "dot-dot": `${root}${path.sep}..${path.sep}private.txt`,
      symlink: path.join(root, "link.jpg"),
      "sibling-prefix": path.join(`${root}-evil`, "photo.jpg"),
    }[kind]!;
    const out = await upload(target);
    expect(out.isError).toBe(true);
    expect(out.content[0]!.text).toMatch(/outside IMMICH_UPLOAD_BASE_DIR/);
    expect(sdkCalls).toHaveLength(0);
  });

  it("uploads a regular file inside the root with its handle metadata", async () => {
    const stat = await fs.stat(inside);
    const out = await upload(inside);
    expect(out.isError).toBeFalsy();
    const call = sdkCalls.find((c) => c.fn === "uploadAsset")!;
    const args = call.args[0] as { assetMediaCreateDto: {
      assetData: File; deviceAssetId: string; fileCreatedAt: string; fileModifiedAt: string;
    } };
    expect(await args.assetMediaCreateDto.assetData.text()).toBe("photo bytes");
    expect(args.assetMediaCreateDto.deviceAssetId).toBe(`photo.jpg-${stat.mtimeMs}`);
    expect(args.assetMediaCreateDto.fileCreatedAt).toBe(stat.mtime.toISOString());
    expect(args.assetMediaCreateDto.fileModifiedAt).toBe(stat.mtime.toISOString());
  });

  it("refuses a directory inside the root", async () => {
    const out = await upload(root);
    expect(out.isError).toBe(true);
    expect(out.content[0]!.text).toMatch(/regular file/);
    expect(sdkCalls).toHaveLength(0);
  });

  it.each([
    [{ allowWrites: false, localFileAccess: false }, /Writes disabled/],
    [{ localFileAccess: false }, /Local filesystem access is disabled/],
  ] as const)("preserves guard order for %j", async (overrides, message) => {
    const realpath = vi.spyOn(fs, "realpath");
    const out = await upload(inside, { ...overrides, uploadBaseDir: undefined });
    expect(out.isError).toBe(true);
    expect(out.content[0]!.text).toMatch(message);
    expect(realpath).not.toHaveBeenCalled();
    expect(sdkCalls).toHaveLength(0);
  });

  it("fails closed on platforms without opened-file path verification", async () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: "darwin" });
    try {
      const out = await upload(inside);
      expect(out.isError).toBe(true);
      expect(out.content[0]!.text).toMatch(/opened-file path verification/);
      expect(sdkCalls).toHaveLength(0);
    } finally {
      Object.defineProperty(process, "platform", platform);
    }
  });

  it.skipIf(process.platform !== "linux")("fails closed when the opened descriptor cannot be resolved", async () => {
    const realpath = fs.realpath.bind(fs);
    vi.spyOn(fs, "realpath").mockImplementation(async (file, ...args) => {
      if (String(file).startsWith("/proc/self/fd/")) throw new Error("procfs unavailable");
      return realpath(file, ...args);
    });
    const out = await upload(inside);
    expect(out.isError).toBe(true);
    expect(out.content[0]!.text).toMatch(/Cannot verify upload file containment/);
    expect(sdkCalls).toHaveLength(0);
  });

  it.skipIf(process.platform !== "linux")("refuses a parent symlink swapped outside between realpath and open", async () => {
    const nested = path.join(root, "nested");
    await fs.mkdir(nested);
    await fs.writeFile(path.join(nested, "photo.jpg"), "safe bytes");
    const open = fs.open.bind(fs);
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    vi.spyOn(fs, "open").mockImplementationOnce(async (...args) => {
      await fs.rename(nested, path.join(root, "saved"));
      await fs.symlink(`${root}-evil`, nested);
      handle = await open(...args);
      return handle;
    });
    const out = await upload(path.join(nested, "photo.jpg"));
    expect(out.isError).toBe(true);
    expect(out.content[0]!.text).toMatch(/outside IMMICH_UPLOAD_BASE_DIR/);
    expect(sdkCalls).toHaveLength(0);
    expect(handle).toBeDefined();
    await expect(handle!.stat()).rejects.toThrow(/closed/);
  });
});
