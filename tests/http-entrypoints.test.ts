import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { beforeAll, expect, it } from "vitest";

// Exercise the real bundler: source-only tests cannot catch bundled entry guards.
beforeAll(async () => {
  await promisify(execFile)("npm", ["run", "build"]);
}, 30_000);

it.each([
  ["dist/index.js", "--http"],
  ["dist/mcp-bin.js", "--http"],
  ["dist/cli.js", "mcp", "--http"],
])("starts exactly one HTTP listener from %s", async (...args) => {
  const child = spawn(process.execPath, args, {
    env: {
      PATH: process.env.PATH,
      IMMICH_BASE_URL: "https://photos.example.com/api",
      IMMICH_API_KEY: "dummy-upstream",
      IMMICH_MCP_HTTP_TOKEN: randomUUID(),
      IMMICH_MCP_HTTP_PORT: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = once(child, "exit");
  let stderr = "";
  let stdout = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  try {
    const deadline = Date.now() + 5_000;
    while (!stderr.includes("HTTP listening") && child.exitCode === null && Date.now() < deadline) await delay(25);
    // Allow any duplicate initialization in the same bundle to finish.
    await delay(100);
    expect(stderr.match(/HTTP listening/g), stderr).toHaveLength(1);
    expect(stderr).not.toContain("EADDRINUSE");
    expect(stdout).toBe("");
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    const [code, signal] = await exited;
    expect(code, stderr).toBe(0);
    expect(signal).toBeNull();
  }
}, 10_000);
