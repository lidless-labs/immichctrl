import { describe, expect, it } from "vitest";
import { installFakeSdk } from "./_fake-sdk.js";

installFakeSdk();

import { assertToolAnnotations, type ToolAnnotations } from "@lidless-labs/effect-operator-kit";
import { annotationsForTier, TOOL_REGISTRY } from "../src/registry.js";
import { createMcpServer } from "../src/server.js";
import { asMcpResponse } from "../src/tools/_util.js";

const config = { baseUrl: "https://photos.example.com/api", apiKey: "k", allowWrites: true, verifySsl: true };

describe("kit tool annotations", () => {
  it("declares explicit hints on every registered tool and passes the kit audit", () => {
    const server = createMcpServer(config);
    const reg = (server as unknown as {
      _registeredTools: Record<string, { annotations?: ToolAnnotations }>;
    })._registeredTools;
    const byName = new Map(Object.entries(reg).map(([name, tool]) => [name, tool.annotations]));
    expect(byName.size).toBe(Object.keys(TOOL_REGISTRY.tiers).length);
    // Untagging or removing an asset from an album changes membership only; the asset
    // is kept, and the executor gates it with requireWrites alone (tier: safe-write).
    assertToolAnnotations(byName, {
      allowNonDestructive: ["immich_remove_assets_from_album", "immich_remove_tag_from_assets"],
    });
  });

  it("keeps the three-tier meaning: reads read-only, safe writes non-destructive, destructive fail-closed", () => {
    expect(annotationsForTier("read")).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(annotationsForTier("safe-write")).toMatchObject({ readOnlyHint: false, destructiveHint: false });
    expect(annotationsForTier("destructive")).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    // A tier the registry does not know is treated as destructive.
    expect(annotationsForTier("bogus" as never)).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });
});

describe("asMcpResponse byte cap", () => {
  it("returns a small payload unchanged and content-only", () => {
    expect(asMcpResponse({ a: 1 })).toEqual({ content: [{ type: "text", text: JSON.stringify({ a: 1 }, null, 2) }] });
  });

  it("truncates an oversize payload with the kit marker and a structured flag", () => {
    const result = asMcpResponse({ rows: "é".repeat(80_000) });
    expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThanOrEqual(90_000);
    expect(result.content[0]!.text).toContain("[truncated: output was");
    expect(result.structuredContent).toMatchObject({ truncated: true, maxBytes: 90_000 });
    expect(result).not.toHaveProperty("details");
  });
});
