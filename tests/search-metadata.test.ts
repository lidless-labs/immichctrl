// Immich Runbook Step 3 proof: server-side search metadata covers every
// registered tool without changing the public MCP tool descriptors.
import { describe, expect, it } from "vitest";
import { installFakeSdk } from "./_fake-sdk.js";

installFakeSdk();

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../src/config.js";
import { DOMAINS, TOOL_SEARCH_META } from "../src/search-metadata.js";
import { registerActivityTools } from "../src/tools/activities.js";
import { registerAlbumFlowTools } from "../src/tools/album-flows.js";
import { registerAlbumTools } from "../src/tools/albums.js";
import { registerAssetTools } from "../src/tools/assets.js";
import { registerDuplicateFlowTools } from "../src/tools/duplicate-flows.js";
import { registerDuplicateTools } from "../src/tools/duplicates.js";
import { registerJobTools } from "../src/tools/jobs.js";
import { registerMemoryTools } from "../src/tools/memories.js";
import { registerMemoryFlowTools } from "../src/tools/memory-flows.js";
import { registerPeopleTools } from "../src/tools/people.js";
import { registerSearchTools } from "../src/tools/search.js";
import { registerSharedLinkTools } from "../src/tools/shared-links.js";
import { registerStackTools } from "../src/tools/stacks.js";
import { registerSystemTools } from "../src/tools/system.js";
import { registerTagTools } from "../src/tools/tags.js";
import { registerTrashTools } from "../src/tools/trash.js";

const testConfig: Config = {
  baseUrl: "https://photos.example.com/api",
  apiKey: "k",
  allowWrites: false,
  verifySsl: true,
};

type RegisteredTool = {
  description?: string;
  domain?: unknown;
  keywords?: unknown;
};

function registerAllTools(): Record<string, RegisteredTool> {
  const server = new McpServer({ name: "immich-mcp", version: "0.0.0-test" });
  registerSystemTools(server, testConfig);
  registerAssetTools(server, testConfig);
  registerSearchTools(server, testConfig);
  registerAlbumTools(server, testConfig);
  registerPeopleTools(server, testConfig);
  registerTagTools(server, testConfig);
  registerSharedLinkTools(server, testConfig);
  registerActivityTools(server, testConfig);
  registerMemoryTools(server, testConfig);
  registerDuplicateTools(server, testConfig);
  registerStackTools(server, testConfig);
  registerDuplicateFlowTools(server, testConfig);
  registerMemoryFlowTools(server, testConfig);
  registerAlbumFlowTools(server, testConfig);
  registerTrashTools(server, testConfig);
  registerJobTools(server, testConfig);
  return (
    server as unknown as {
      _registeredTools: Record<string, RegisteredTool>;
    }
  )._registeredTools;
}

function normalizeVisibleText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const registered = registerAllTools();
const registeredNames = Object.keys(registered).sort();

describe("search metadata (Immich Runbook Step 3)", () => {
  it("covers exactly all 74 registered tools", () => {
    expect(registeredNames).toHaveLength(74);
    expect(Object.keys(TOOL_SEARCH_META).sort()).toEqual(registeredNames);
  });

  it("uses only declared domains and at least three distinct blind-authored keywords", () => {
    expect(Object.isFrozen(DOMAINS)).toBe(true);
    const declaredDomains = new Set<string>(DOMAINS);

    for (const [name, metadata] of Object.entries(TOOL_SEARCH_META)) {
      expect.soft(declaredDomains.has(metadata.domain), `${name}: ${metadata.domain}`).toBe(true);
      expect.soft(metadata.keywords.length, name).toBeGreaterThanOrEqual(3);
      expect.soft(new Set(metadata.keywords).size, `${name}: duplicate keywords`).toBe(
        metadata.keywords.length,
      );

      const visible = normalizeVisibleText(
        `${name.replace(/^immich_/, "")} ${registered[name]?.description ?? ""}`,
      );
      for (const keyword of metadata.keywords) {
        expect.soft(keyword, `${name}: keyword must be nonempty`).not.toBe("");
        expect.soft(keyword, `${name}: keyword must be lowercase`).toBe(keyword.toLowerCase());
        expect.soft(keyword, `${name}: keyword must be trimmed`).toBe(keyword.trim());
        expect.soft(keyword, `${name}: keyword spacing must be normalized`).toBe(
          normalizeVisibleText(keyword),
        );
        expect.soft(
          ` ${visible} `.includes(` ${keyword} `),
          `${name}: "${keyword}" already appears in the tool name or description`,
        ).toBe(false);
      }
    }
  });

  it("keeps search metadata out of the registered MCP tool descriptors", () => {
    for (const [name, tool] of Object.entries(registered)) {
      expect(tool, name).not.toHaveProperty("domain");
      expect(tool, name).not.toHaveProperty("keywords");
    }
  });
});
