import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaults, getServerVersion, init } from "@immich/sdk";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { applyTlsPolicy, resetTlsWarning, type TlsDeps } from "../src/tls.js";

/**
 * End-to-end TLS check: a real local HTTPS server with a throwaway CA and leaf,
 * a real SDK call through the scoped fetch, and a plain global fetch as the
 * control that must still reject the same certificate.
 */

function openssl(cwd: string, ...args: string[]): void {
  execFileSync("openssl", args, { cwd, stdio: "pipe" });
}

describe("TLS policy against a real HTTPS server", () => {
  let dir: string;
  let server: https.Server;
  let baseUrl: string;
  let caPath: string;
  const savedEnv = process.env.NODE_TLS_REJECT_UNAUTHORIZED;

  const deps = (): TlsDeps => ({
    readFile: (path) => readFileSync(path, "utf8"),
    createAgent: (options) => new https.Agent(options),
    warn: vi.fn(),
    setFetch: (fetchImpl) => {
      defaults.fetch = fetchImpl;
    },
  });

  beforeAll(async () => {
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    dir = mkdtempSync(join(tmpdir(), "immich-tls-"));
    openssl(dir, "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.pem",
      "-days", "1", "-subj", "/CN=immich-mcp test CA",
      "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign");
    openssl(dir, "req", "-newkey", "rsa:2048", "-nodes", "-keyout", "leaf.key", "-out", "leaf.csr",
      "-subj", "/CN=127.0.0.1");
    writeFileSync(join(dir, "ext.cnf"), "subjectAltName=IP:127.0.0.1\nbasicConstraints=CA:FALSE\n");
    openssl(dir, "x509", "-req", "-in", "leaf.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial",
      "-out", "leaf.pem", "-days", "1", "-extfile", "ext.cnf");
    caPath = join(dir, "ca.pem");

    server = https.createServer(
      { key: readFileSync(join(dir, "leaf.key")), cert: readFileSync(join(dir, "leaf.pem")) },
      (req, res) => {
        if (req.url === "/api/server/version") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ major: 2, minor: 7, patch: 5 }));
        } else {
          res.writeHead(404).end();
        }
      },
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `https://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });

  afterAll(async () => {
    delete defaults.fetch;
    if (savedEnv === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = savedEnv;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });

  it("plain global fetch rejects the private certificate", async () => {
    const error = await fetch(`${baseUrl}/server/version`).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(Error);
    const code = String((error as { cause?: { code?: string } }).cause?.code);
    expect(code).toMatch(/SELF_SIGNED|UNABLE_TO_VERIFY|CERT/);
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
  });

  it("SDK call succeeds with IMMICH_CA_CERT and verification on", async () => {
    resetTlsWarning();
    expect(applyTlsPolicy({ verifySsl: true, caCertPath: caPath }, deps())).toBe(true);
    init({ baseUrl, apiKey: "test-key" });
    await expect(getServerVersion()).resolves.toEqual({ major: 2, minor: 7, patch: 5 });
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
  });

  it("SDK call fails with verification on and no CA configured", async () => {
    delete defaults.fetch;
    init({ baseUrl, apiKey: "test-key" });
    await expect(getServerVersion()).rejects.toThrow();
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
  });

  it("SDK call succeeds with verification disabled, scoped to the SDK", async () => {
    resetTlsWarning();
    const d = deps();
    expect(applyTlsPolicy({ verifySsl: false }, d)).toBe(true);
    expect(d.warn).toHaveBeenCalledTimes(1);
    init({ baseUrl, apiKey: "test-key" });
    await expect(getServerVersion()).resolves.toEqual({ major: 2, minor: 7, patch: 5 });

    // The opt-out must not leak: global fetch still rejects the same server.
    const error = await fetch(`${baseUrl}/server/version`).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(Error);
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
  });
});
