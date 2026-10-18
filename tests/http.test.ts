import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { request } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHttpServer, type HttpServerHandle } from "../src/http.js";
import { resetFakeSdk, sdkCalls, mockSdkResponse } from "./_fake-sdk.js";

vi.mock("@immich/sdk", async () => {
  const { sdkCalls, sdkResponses } = await import("./_fake-sdk.js");
  return Object.fromEntries(["init", "deleteAssets", "getAssetDuplicates", "searchAssets", "getAllAlbums"].map((fn) => [fn, (...args: unknown[]) => {
    sdkCalls.push({ fn, args });
    return Promise.resolve(sdkResponses.get(fn));
  }]));
});

const TOKEN = randomUUID();
const env = {
  IMMICH_BASE_URL: "https://photos.example.com/api",
  IMMICH_API_KEY: "test-upstream-secret",
  IMMICH_MCP_HTTP_TOKEN: TOKEN,
  IMMICH_MCP_HTTP_PORT: "0",
  IMMICH_MCP_HTTP_HOST: undefined,
  IMMICH_ALLOW_WRITES: undefined,
};
let http: HttpServerHandle | undefined;

const connections: { client: Client; transport: StreamableHTTPClientTransport }[] = [];
afterEach(async () => {
  for (const { client, transport } of connections.splice(0)) {
    await transport.terminateSession().catch(() => undefined);
    await client.close();
  }
  await http?.close();

  http = undefined;
  resetFakeSdk();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function configure(extra = {}) {
  for (const [name, value] of Object.entries({ ...env, ...extra })) vi.stubEnv(name, value);
}
async function start(extra = {}) {
  configure(extra);
  http = await createHttpServer();
  return `http://localhost:${http.port}`;
}
async function connect(url: string) {
  const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
  });
  const client = new Client({ name: "http-test", version: "1" });
  connections.push({ client, transport });
  await client.connect(transport);
  return { client, transport };
}

describe("authenticated Streamable HTTP", () => {
  it.each([undefined, "Bearer wrong-token"])("rejects invalid authentication: %s", async (authorization) => {
    const url = await start();
    const response = await fetch(`${url}/mcp`, { method: "POST", headers: authorization ? { authorization } : {} });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(await response.text()).toBe("Unauthorized");
  });

  it("exposes only liveness without authentication", async () => {
    const response = await fetch(`${await start()}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("lists tools using the SDK client and terminates its session", async () => {
    const url = await start();
    const { client, transport } = await connect(url);
    const result = await client.listTools();
    expect(result.tools).toHaveLength(74);
    expect(result.tools.some((t) => t.name === "immich_ping")).toBe(true);
    const id = transport.sessionId;
    expect(id).toBeTruthy();
    await transport.terminateSession();
    const stale = await fetch(`${url}/mcp`, {
      headers: { authorization: `Bearer ${TOKEN}`, "mcp-session-id": id!, accept: "text/event-stream" },
    });
    expect(stale.status).toBe(404);
  });

  it.each([
    { origin: "https://evil.example.com" },
    { origin: "null" },
    { origin: "http://localhost.evil.example.com" },
    { host: "evil.example.com" },
    { host: "localhost@evil.example.com" },
  ])("rejects rebinding headers %j", async (headers) => {
    const url = await start();
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(`${url}/mcp`, { method: "POST", headers: { ...headers, authorization: `Bearer ${TOKEN}` } }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      });
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(403);
  });

  it("accepts a loopback Origin", async () => {
    const url = await start();
    const response = await fetch(`${url}/mcp`, { method: "POST", headers: { origin: url } });
    expect(response.status).toBe(401);
  });

  it.each([undefined, "", "   ", env.IMMICH_API_KEY,
  ])("refuses missing, blank, or reused credentials", async (token) => {
    configure({ IMMICH_MCP_HTTP_TOKEN: token });
    await expect(createHttpServer()).rejects.toThrow(/IMMICH_MCP_HTTP_TOKEN/);
  });

  it.each(["-1", "65536", "abc", "3000suffix", "1.5"])("refuses invalid port %s", async (port) => {
    configure({ IMMICH_MCP_HTTP_PORT: port });
    await expect(createHttpServer()).rejects.toThrow(/IMMICH_MCP_HTTP_PORT/);
  });

  it("limits request bytes before JSON parsing", async () => {
    const url = await start();
    const response = await fetch(`${url}/mcp`, {
      method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: "x".repeat(1_048_577),
    });
    expect(response.status).toBe(413);
  });

  it("limits chunked bodies without a Content-Length", async () => {
    const url = await start();
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(`${url}/mcp`, {
        method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode));
      });
      req.on("error", reject);
      req.write("x".repeat(600_000));
      req.end("x".repeat(600_000));
    });
    expect(status).toBe(413);
  });

  it("expires idle sessions even with an SSE channel open", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const url = await start();
    const { transport } = await connect(url);
    const id = transport.sessionId!;
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31 * 60_000);
    await vi.advanceTimersByTimeAsync(60_000);
    const response = await fetch(`${url}/mcp`, {
      headers: { authorization: `Bearer ${TOKEN}`, "mcp-session-id": id, accept: "text/event-stream" },
    });
    expect(response.status).toBe(404);
  });

  it("keeps confirmations call-local across sessions and never retains preview plans", async () => {
    const url = await start({ IMMICH_ALLOW_WRITES: "true" });
    const [a, b] = await Promise.all([connect(url), connect(url)]);
    expect(a.transport.sessionId).not.toBe(b.transport.sessionId);
    const args = {
      keep: ["00000000-0000-0000-0000-000000000001"],
      discard: ["00000000-0000-0000-0000-000000000002"],
    };
    const preview = await a.client.callTool({ name: "immich_resolve_duplicates", arguments: args });
    expect(preview.isError).not.toBe(true);
    mockSdkResponse("deleteAssets", {});
    const confirmed = await a.client.callTool({ name: "immich_resolve_duplicates", arguments: { ...args, delete: true, confirm: true } });
    expect(confirmed.isError, JSON.stringify(confirmed.content)).not.toBe(true);
    for (const connection of [b, a]) {
      const result = await connection.client.callTool({ name: "immich_resolve_duplicates", arguments: { ...args, delete: true } });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("confirm: true");
    }
    expect(sdkCalls.filter((c) => c.fn === "deleteAssets")).toHaveLength(1);
    expect(sdkCalls.filter((c) => c.fn === "init")).toHaveLength(1);
  });

  it("blocks host filesystem uploads and exports even with writes enabled", async () => {
    const url = await start({ IMMICH_ALLOW_WRITES: "true" });
    const { client } = await connect(url);
    const upload = await client.callTool({ name: "immich_upload_asset_from_path", arguments: { filePath: "package.json" } });
    expect(upload.isError).toBe(true);
    expect(JSON.stringify(upload.content)).toContain("Local filesystem access is disabled over HTTP");
    mockSdkResponse("getAssetDuplicates", []);
    mockSdkResponse("getAllAlbums", []);
    const exported = await client.callTool({ name: "immich_resolve_with_keep_strategy", arguments: { strategy: "byte_dupes_keep_oldest", exportTo: "plan.csv" } });
    expect(exported.isError).toBe(true);
    expect(JSON.stringify(exported.content)).toContain("Local filesystem access is disabled over HTTP");
    mockSdkResponse("searchAssets", { assets: { items: [] } });
    const audit = await client.callTool({ name: "immich_audit_trash", arguments: { exportTo: "audit.csv" } });
    expect(audit.isError).toBe(true);
    expect(JSON.stringify(audit.content)).toContain("Local filesystem access is disabled over HTTP");
    expect(sdkCalls.some((c) => c.fn === "uploadAsset")).toBe(false);
  });

  it("allows host filesystem exports when IMMICH_MCP_HTTP_LOCAL_FILES=true", async () => {
    const url = await start({ IMMICH_ALLOW_WRITES: "true", IMMICH_MCP_HTTP_LOCAL_FILES: "true" });
    const { client } = await connect(url);
    mockSdkResponse("searchAssets", { assets: { items: [] } });
    const dir = await mkdtemp(join(tmpdir(), "immich-http-"));
    try {
      const audit = await client.callTool({ name: "immich_audit_trash", arguments: { exportTo: join(dir, "audit.csv") } });
      expect(JSON.stringify(audit.content)).not.toContain("Local filesystem access is disabled over HTTP");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a malformed IMMICH_MCP_HTTP_LOCAL_FILES value", async () => {
    configure({ IMMICH_MCP_HTTP_TOKEN: TOKEN, IMMICH_MCP_HTTP_LOCAL_FILES: "yes" });
    await expect(createHttpServer()).rejects.toThrow(/IMMICH_MCP_HTTP_LOCAL_FILES/);
  });

  it("caps live sessions and recovers capacity after DELETE", async () => {
    const url = await start();
    for (let i = 0; i < 128; i++) await connect(url);
    const response = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "cap", version: "1" } } }),
    });
    expect(response.status).toBe(503);
    await connections[0]!.transport.terminateSession();
    await connect(url);
  });

  it.each(["user-secret", "password-secret"])("refuses upstream URL credential reuse: %s", async (token) => {
    configure({ IMMICH_BASE_URL: "https://user-secret:password-secret@photos.example.com/api", IMMICH_MCP_HTTP_TOKEN: token });
    await expect(createHttpServer()).rejects.toThrow(/IMMICH_MCP_HTTP_TOKEN/);
  });

  it("closes active sessions and the listener idempotently", async () => {
    const url = await start();
    await connect(url);
    await Promise.all([http!.close(), http!.close()]);
    await expect(fetch(`${url}/healthz`)).rejects.toThrow();
  });
});
