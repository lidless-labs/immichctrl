import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { run } from "../src/cli.js";
import { getConfig } from "../src/config.js";
import { initImmichClient } from "../src/client.js";
import type { ImmichClient } from "../src/immich-client.js";
import { _resetForTests, redact, registerSecret } from "../src/security.js";
import { createMcpServer } from "../src/server.js";
import { withRetry } from "../src/retry.js";
import { asMcpError } from "../src/tools/_util.js";

// Assembled at runtime so the fixture is not a secret-shaped literal.
const SECRET = ["key", "Zq7vK2mW9xT4pL8dR5sN3hB6cF1yJ0"].join("-");
// Padding sizes that put the 90,000 byte cut at every offset inside the secret.
const SWEEP = Array.from({ length: 420 }, (_, i) => 89_400 + i);

/** No prefix of the secret (4+ chars) may survive, which is what a cut through it leaves. */
function expectNoSecretFragment(output: string): void {
  for (let k = 4; k <= SECRET.length; k++) {
    expect(output.includes(SECRET.slice(0, k)), `prefix ${SECRET.slice(0, k)}`).toBe(false);
  }
}

describe("redaction runs on the full value before the byte cap", () => {
  beforeEach(() => {
    _resetForTests();
    registerSecret(SECRET);
  });

  it("error results never leave a secret fragment at the cap boundary", () => {
    let truncated = 0;
    for (const pad of SWEEP) {
      const result = asMcpError("a".repeat(pad) + SECRET + "b".repeat(2_000));
      if (result.structuredContent?.truncated === true) truncated += 1;
      expectNoSecretFragment(result.content[0]!.text);
    }
    expect(truncated).toBeGreaterThan(0);
  });

  it("redacts a secret that sits entirely under the cap", () => {
    const result = asMcpError(`Immich API 500: upstream echoed ${SECRET}`);
    expect(result.content[0]!.text).toBe("Immich API 500: upstream echoed [REDACTED]");
  });

  it("masks URL userinfo even when it was never registered", () => {
    expect(redact("GET http://someone:hunter2hunter2@photos.invalid/api/x failed")).toBe(
      "GET http://[REDACTED]@photos.invalid/api/x failed",
    );
  });

  it("masks userinfo whose password contains an @", () => {
    expect(redact("GET http://usr:p@ss@photos.invalid/x failed")).toBe("GET http://[REDACTED]@photos.invalid/x failed");
  });

  it("keeps the confirm refusal text intact", () => {
    expect(asMcpError("immich_empty_trash is destructive. Pass { confirm: true } in tool args to proceed.")).toEqual({
      isError: true,
      content: [{ type: "text", text: "immich_empty_trash is destructive. Pass { confirm: true } in tool args to proceed." }],
    });
  });
});

describe("credentials in IMMICH_BASE_URL", () => {
  const URL_PASSWORD = ["pw", "URLSECRET", "Zq7vK2mW9"].join("-");

  beforeEach(() => {
    _resetForTests();
    vi.stubEnv("IMMICH_BASE_URL", `http://usr:${URL_PASSWORD}@127.0.0.1:1`);
    vi.stubEnv("IMMICH_API_KEY", SECRET);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("never reaches an MCP error result", async () => {
    const config = getConfig();
    initImmichClient(config);
    const server = createMcpServer(config);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "redaction-order-test", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const result = await client.callTool({ name: "immich_ping", arguments: {} });
      expect(result.isError).toBe(true);
      const text = JSON.stringify(result.content);
      expect(text).toContain("[REDACTED]");
      expect(text).not.toContain(URL_PASSWORD);
      expect(text).not.toContain(SECRET);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("never reaches CLI stderr", async () => {
    getConfig();
    const err: string[] = [];
    const code = await run(["ping"], {
      out: () => undefined,
      err: (line) => err.push(line),
      makeClient: () =>
        ({
          ping: async () => {
            throw new Error(`connect failed for http://usr:${URL_PASSWORD}@127.0.0.1:1 with ${SECRET}`);
          },
        }) as unknown as ImmichClient,
      serve: async () => undefined,
    });
    expect(code).toBe(1);
    const text = err.join("\n");
    expect(text).not.toContain(URL_PASSWORD);
    expect(text).not.toContain(SECRET);
    expect(text).toContain("[REDACTED]");
  });
});

describe("other output paths", () => {
  beforeEach(() => {
    _resetForTests();
    registerSecret(SECRET);
  });

  it("redacts the retry diagnostic written to stderr", async () => {
    vi.useFakeTimers();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const failure = Object.assign(new Error(`upstream 503 for ${SECRET} at http://usr:hunter2hunter2@photos.invalid`), { status: 503 });
      const fn = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce("ok");
      const pending = withRetry("album", fn);
      await vi.runAllTimersAsync();
      await expect(pending).resolves.toBe("ok");
      const logged = errSpy.mock.calls.map((call) => String(call[0])).join("\n");
      expect(logged).toContain("retry 1/3 for album");
      expect(logged).not.toContain(SECRET);
      expect(logged).not.toContain("hunter2hunter2");
    } finally {
      errSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("redacts the configured API key from a parse error before config is loaded", async () => {
    vi.stubEnv("IMMICH_BASE_URL", "http://photos.invalid");
    vi.stubEnv("IMMICH_API_KEY", SECRET);
    _resetForTests();
    try {
      const err: string[] = [];
      const code = await run([SECRET], {
        out: () => undefined,
        err: (line) => err.push(line),
        makeClient: () => ({}) as unknown as ImmichClient,
        serve: async () => undefined,
      });
      expect(code).toBe(2);
      expect(err.join("\n")).not.toContain(SECRET);
      expect(err.join("\n")).toContain("[REDACTED]");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("redacts the argument parse error", async () => {
    const err: string[] = [];
    const code = await run(["http://usr:hunter2hunter2@photos.invalid/x"], {
      out: () => undefined,
      err: (line) => err.push(line),
      makeClient: () => ({}) as unknown as ImmichClient,
      serve: async () => undefined,
    });
    expect(code).toBe(2);
    expect(err.join("\n")).not.toContain("hunter2hunter2");
  });
});
