import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { installFakeSdk, resetFakeSdk, sdkCalls } from "./_fake-sdk.js";

installFakeSdk();

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../src/config.js";
import { registerSystemTools } from "../src/tools/system.js";
import { registerAssetTools } from "../src/tools/assets.js";
import { registerSearchTools } from "../src/tools/search.js";
import { registerAlbumTools } from "../src/tools/albums.js";
import { registerPeopleTools } from "../src/tools/people.js";
import { registerTagTools } from "../src/tools/tags.js";
import { registerSharedLinkTools } from "../src/tools/shared-links.js";
import { registerActivityTools } from "../src/tools/activities.js";
import { registerMemoryTools } from "../src/tools/memories.js";
import { registerDuplicateTools } from "../src/tools/duplicates.js";
import { registerStackTools } from "../src/tools/stacks.js";
import { registerDuplicateFlowTools } from "../src/tools/duplicate-flows.js";
import { registerMemoryFlowTools } from "../src/tools/memory-flows.js";
import { registerAlbumFlowTools } from "../src/tools/album-flows.js";
import { registerTrashTools } from "../src/tools/trash.js";
import { registerJobTools } from "../src/tools/jobs.js";

type ToolTier = "read" | "safe-write" | "destructive";
type Category = "single-domain" | "cross-domain" | "safety-sensitive";

interface GateProbe {
  tool: string;
  args: Record<string, unknown>;
}

interface Prompt {
  id: string;
  category: Category;
  prompt: string;
  expected_tools: string[];
  accept_alternatives?: string[][];
  required_tier?: ToolTier;
  gate_probe?: GateProbe;
}

interface FrozenSet {
  schema: string;
  frozen: boolean;
  prompts: Prompt[];
}

interface ToolResult {
  isError?: boolean;
  content: Array<{ text: string }>;
}

interface RegisteredTool {
  handler: (args: unknown, extra?: unknown) => Promise<unknown>;
}

const cfg = (allowWrites: boolean): Config => ({
  baseUrl: "https://photos.example.com/api",
  apiKey: "test-key",
  allowWrites,
  verifySsl: true,
});

function createRegisteredServer(allowWrites: boolean): McpServer {
  const server = new McpServer({ name: "immich-mcp", version: "0.0.0-test" });
  const config = cfg(allowWrites);
  registerSystemTools(server, config);
  registerAssetTools(server, config);
  registerSearchTools(server, config);
  registerAlbumTools(server, config);
  registerPeopleTools(server, config);
  registerTagTools(server, config);
  registerSharedLinkTools(server, config);
  registerActivityTools(server, config);
  registerMemoryTools(server, config);
  registerDuplicateTools(server, config);
  registerStackTools(server, config);
  registerDuplicateFlowTools(server, config);
  registerMemoryFlowTools(server, config);
  registerAlbumFlowTools(server, config);
  registerTrashTools(server, config);
  registerJobTools(server, config);
  return server;
}

function registeredTools(server: McpServer): Record<string, RegisteredTool> {
  return (server as unknown as { _registeredTools: Record<string, RegisteredTool> })._registeredTools;
}

async function callTool(
  allowWrites: boolean,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const tool = registeredTools(createRegisteredServer(allowWrites))[name];
  if (!tool) throw new Error(`tool ${name} is not registered`);
  return tool.handler(args, {}) as Promise<ToolResult>;
}

function errorText(result: ToolResult): string {
  return result.content.map((part) => part.text).join("\n");
}

/**
 * Derives the requested scenario's tier from handler behavior. It deliberately
 * invokes the executor with writes disabled, then with writes enabled and no
 * confirmation, rather than reading descriptions or future registry metadata.
 */
async function deriveTierFromExecutor(probe: GateProbe): Promise<ToolTier> {
  resetFakeSdk();
  const writesDisabled = await callTool(false, probe.tool, probe.args);
  const disabledText = errorText(writesDisabled);

  if (!writesDisabled.isError || !disabledText.includes("Writes disabled")) {
    expect(writesDisabled.isError, `${probe.tool} read scenario must not fail`).toBeFalsy();
    expect(sdkCalls, `${probe.tool} read scenario must not touch the SDK`).toEqual([]);
    return "read";
  }
  expect(sdkCalls, `${probe.tool} writes-disabled gate must run before the SDK`).toEqual([]);

  resetFakeSdk();
  const noConfirm = await callTool(true, probe.tool, probe.args);
  const noConfirmText = errorText(noConfirm);
  if (noConfirm.isError && noConfirmText.includes("confirm: true")) {
    expect(sdkCalls, `${probe.tool} confirmation gate must run before the SDK`).toEqual([]);

    resetFakeSdk();
    await callTool(true, probe.tool, { ...probe.args, confirm: true });
    expect(sdkCalls.length, `${probe.tool} must reach its executor after confirmation`).toBeGreaterThan(0);
    return "destructive";
  }

  expect(sdkCalls.length, `${probe.tool} must reach its executor once writes are enabled`).toBeGreaterThan(0);
  return "safe-write";
}

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "benchmarks",
  "dynamic-tools",
  "prompts.json",
);
const fixtureBytes = readFileSync(fixturePath);
const frozen = JSON.parse(fixtureBytes.toString("utf8")) as FrozenSet;

describe("dynamic-tools benchmark freeze", () => {
  it("pins the frozen prompt count and category split", () => {
    const byCategory: Record<Category, number> = {
      "single-domain": 0,
      "cross-domain": 0,
      "safety-sensitive": 0,
    };
    for (const prompt of frozen.prompts) byCategory[prompt.category]++;

    expect(frozen.schema).toBe("immich-dynamic-tools-benchmark/1");
    expect(frozen.frozen).toBe(true);
    expect(createHash("sha256").update(fixtureBytes).digest("hex")).toBe(
      "62893e4408a9b57181ac466f03867a7090843a68d925b6c682eeb7686cde5258",
    );
    expect(frozen.prompts).toHaveLength(32);
    expect(byCategory).toEqual({
      "single-domain": 16,
      "cross-domain": 8,
      "safety-sensitive": 8,
    });
    expect(new Set(frozen.prompts.map((prompt) => prompt.id)).size).toBe(frozen.prompts.length);
  });

  it("keeps every expected or accepted alternative label registered", () => {
    const registered = new Set(Object.keys(registeredTools(createRegisteredServer(false))));
    expect(registered.size).toBe(74);

    const unknown: Array<{ id: string; tool: string }> = [];
    for (const prompt of frozen.prompts) {
      const accepted = [prompt.expected_tools, ...(prompt.accept_alternatives ?? [])];
      for (const sequence of accepted) {
        expect(sequence, `${prompt.id} has an empty accepted tool sequence`).not.toEqual([]);
        for (const tool of sequence) {
          if (!registered.has(tool)) unknown.push({ id: prompt.id, tool });
        }
      }
    }

    expect(unknown).toEqual([]);
  });

  it("matches every safety prompt tier to the executor gates for its exact scenario", async () => {
    const safetyPrompts = frozen.prompts.filter((prompt) => prompt.category === "safety-sensitive");
    expect(safetyPrompts).toHaveLength(8);

    for (const prompt of safetyPrompts) {
      expect(prompt.required_tier, `${prompt.id} is missing required_tier`).toBeDefined();
      expect(prompt.gate_probe, `${prompt.id} is missing a gate probe`).toBeDefined();
      expect(prompt.expected_tools).toEqual([prompt.gate_probe!.tool]);

      const actualTier = await deriveTierFromExecutor(prompt.gate_probe!);
      expect(actualTier, `${prompt.id} required_tier drifted from executor behavior`).toBe(prompt.required_tier);
    }
  });
});
