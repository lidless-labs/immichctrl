import { EventEmitter } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type https from "node:https";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyTlsPolicy,
  createScopedFetch,
  resetTlsWarning,
  resolveTlsOptions,
  type TlsDeps,
} from "../src/tls.js";

const PEM = "-----BEGIN CERTIFICATE-----\nMIIBexample\n-----END CERTIFICATE-----\n";

function makeDeps(overrides: Partial<TlsDeps> = {}): TlsDeps & {
  createAgent: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  setFetch: ReturnType<typeof vi.fn>;
  readFile: ReturnType<typeof vi.fn>;
} {
  return {
    readFile: vi.fn(() => PEM),
    createAgent: vi.fn(() => ({}) as https.Agent),
    warn: vi.fn(),
    setFetch: vi.fn(),
    ...overrides,
  } as never;
}

describe("TLS policy", () => {
  const savedEnv = process.env.NODE_TLS_REJECT_UNAUTHORIZED;

  beforeEach(() => {
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    resetTlsWarning();
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = savedEnv;
  });

  it("default config installs no agent or fetch and leaves process.env untouched", () => {
    const deps = makeDeps();
    expect(applyTlsPolicy({ verifySsl: true }, deps)).toBe(false);
    expect(deps.createAgent).not.toHaveBeenCalled();
    expect(deps.setFetch).not.toHaveBeenCalled();
    expect(deps.readFile).not.toHaveBeenCalled();
    expect(deps.warn).not.toHaveBeenCalled();
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
  });

  it("opt-out creates a scoped agent, warns once, and never touches process.env", () => {
    const deps = makeDeps();
    expect(applyTlsPolicy({ verifySsl: false }, deps)).toBe(true);
    expect(applyTlsPolicy({ verifySsl: false }, deps)).toBe(true);
    expect(deps.createAgent).toHaveBeenCalledTimes(2);
    expect(deps.createAgent.mock.calls[0]?.[0]).toEqual({ rejectUnauthorized: false });
    expect(deps.setFetch).toHaveBeenCalledWith(expect.any(Function));
    expect(deps.warn).toHaveBeenCalledTimes(1);
    expect(deps.warn.mock.calls[0]?.[0]).toContain("IMMICH_VERIFY_SSL=false");
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
  });

  it("CA path is read and passed to the agent with verification still on", () => {
    const deps = makeDeps();
    expect(applyTlsPolicy({ verifySsl: true, caCertPath: "/etc/immich/ca.pem" }, deps)).toBe(true);
    expect(deps.readFile).toHaveBeenCalledWith("/etc/immich/ca.pem");
    const options = deps.createAgent.mock.calls[0]?.[0];
    expect(options.rejectUnauthorized).toBe(true);
    expect(options.ca).toContain(PEM);
    expect(options.ca.length).toBeGreaterThan(1); // system roots are kept
    expect(deps.warn).not.toHaveBeenCalled();
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
  });

  it("rejects an unreadable or non-PEM CA file with a clear error", () => {
    const missing = makeDeps({
      readFile: vi.fn(() => {
        throw new Error("ENOENT");
      }),
    });
    expect(() => resolveTlsOptions({ verifySsl: true, caCertPath: "/nope.pem" }, missing)).toThrow(
      /IMMICH_CA_CERT could not be read/,
    );
    const junk = makeDeps({ readFile: vi.fn(() => "not a cert") });
    expect(() => resolveTlsOptions({ verifySsl: true, caCertPath: "/junk.pem" }, junk)).toThrow(
      /does not contain a PEM certificate/,
    );
  });

  it("scoped fetch sends requests through the given agent and returns the response", async () => {
    const agent = {} as https.Agent;
    const seen: { url?: string; opts?: Record<string, unknown>; body?: Buffer } = {};
    const fakeHttps = vi.fn((url: URL, opts: Record<string, unknown>, cb: (res: unknown) => void) => {
      seen.url = url.toString();
      seen.opts = opts;
      const req = new EventEmitter() as EventEmitter & { end: (b?: Buffer) => void; setTimeout: () => void };
      req.setTimeout = () => undefined;
      req.end = (b?: Buffer) => {
        seen.body = b;
        const res = Object.assign(Readable.from([Buffer.from('{"ok":true}')]), {
          statusCode: 200,
          statusMessage: "OK",
          headers: { "content-type": "application/json" },
        });
        cb(res);
      };
      return req;
    });
    const scoped = createScopedFetch(agent, { http: vi.fn() as never, https: fakeHttps as never });
    const res = await scoped("https://photos.example.com/api/server/ping", {
      method: "POST",
      headers: { "x-api-key": "k" },
      body: '{"a":1}',
    });
    expect(seen.opts?.agent).toBe(agent);
    expect(seen.opts?.method).toBe("POST");
    expect((seen.opts?.headers as Record<string, string>)["x-api-key"]).toBe("k");
    expect(seen.body?.toString()).toBe('{"a":1}');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("scoped fetch does not pass the https agent to plain http URLs", async () => {
    let opts: Record<string, unknown> | undefined;
    const fakeHttp = vi.fn((_url: URL, o: Record<string, unknown>, cb: (res: unknown) => void) => {
      opts = o;
      const req = new EventEmitter() as EventEmitter & { end: () => void; setTimeout: () => void };
      req.setTimeout = () => undefined;
      req.end = () => cb(Object.assign(Readable.from([]), { statusCode: 204, headers: {} }));
      return req;
    });
    const scoped = createScopedFetch({} as https.Agent, { http: fakeHttp as never, https: vi.fn() as never });
    const res = await scoped("http://192.0.2.10:2283/api/server/ping");
    expect(opts && "agent" in opts).toBe(false);
    expect(res.status).toBe(204);
  });

  describe("against a server that never responds", () => {
    let server: http.Server;
    let url: string;

    beforeEach(async () => {
      server = http.createServer(() => {
        // Accept the request and never answer.
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/server/ping`;
    });

    afterEach(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it("rejects once the injected timeout elapses instead of hanging", async () => {
      const scoped = createScopedFetch({} as https.Agent, undefined, 150);
      await expect(scoped(url)).rejects.toThrow(/Immich request timed out/);
    });

    it("rejects when the caller's AbortSignal fires", async () => {
      const scoped = createScopedFetch({} as https.Agent, undefined, 60_000);
      const controller = new AbortController();
      const pending = scoped(url, { signal: controller.signal });
      setTimeout(() => controller.abort(), 50);
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    });
  });
});
