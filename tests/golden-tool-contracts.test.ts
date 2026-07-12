import { beforeEach, describe, expect, it } from "vitest";
import { installFakeSdk, mockSdkResponse, resetFakeSdk, sdkCalls } from "./_fake-sdk.js";

installFakeSdk();

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAssetTools } from "../src/tools/assets.js";
import { registerDuplicateTools } from "../src/tools/duplicates.js";
import { registerPeopleTools } from "../src/tools/people.js";
import { registerSystemTools } from "../src/tools/system.js";
import { registerTagTools } from "../src/tools/tags.js";
import { registerTrashTools } from "../src/tools/trash.js";

const UUID_A = "00000000-0000-0000-0000-000000000001";
const UUID_B = "00000000-0000-0000-0000-000000000002";
const cfgRead = { baseUrl: "https://photos.example.com/api", apiKey: "k", allowWrites: false, verifySsl: true };
const cfgWrite = { ...cfgRead, allowWrites: true };

type ToolResult = {
  isError?: boolean;
  details?: unknown;
  content: Array<{ type: "text"; text: string }>;
};

async function callTool(server: McpServer, name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  const reg = (server as unknown as {
    _registeredTools: Record<string, { handler: (a: unknown, extra?: unknown) => Promise<unknown> }>;
  })._registeredTools;
  const tool = reg[name];
  if (!tool) throw new Error(`tool ${name} not registered`);
  return (await tool.handler(args, {})) as ToolResult;
}

function makeServer(config = cfgWrite): McpServer {
  const server = new McpServer({ name: "immich-mcp", version: "0.0.0-test" });
  registerAssetTools(server, config);
  registerDuplicateTools(server, config);
  registerPeopleTools(server, config);
  registerSystemTools(server, config);
  registerTagTools(server, config);
  registerTrashTools(server, config);
  return server;
}

function parsedPayload(result: ToolResult): unknown {
  expect(result.isError).toBeUndefined();
  expect(result.details).toBeUndefined();
  expect(result.content).toHaveLength(1);
  expect(result.content[0]).toMatchObject({ type: "text" });
  return JSON.parse(result.content[0]!.text);
}

describe("golden confirm-gated destructive refusal contracts", () => {
  let server: McpServer;

  beforeEach(() => {
    resetFakeSdk();
    server = makeServer(cfgWrite);
  });

  it.each([
    {
      name: "immich_bulk_update_assets",
      args: { ids: [UUID_A], isFavorite: true },
      refusal: "immich_bulk_update_assets is destructive. Pass { confirm: true } in tool args to proceed.",
    },
    {
      name: "immich_delete_asset",
      args: { ids: [UUID_A], permanent: true },
      refusal: "immich_delete_asset is destructive. Pass { confirm: true } in tool args to proceed.",
    },
    {
      name: "immich_resolve_duplicates",
      args: { keep: [UUID_A], discard: [UUID_B], delete: true },
      refusal: "immich_resolve_duplicates is destructive. Pass { confirm: true } in tool args to proceed.",
    },
    {
      name: "immich_merge_people",
      args: { id: UUID_A, ids: [UUID_B] },
      refusal: "immich_merge_people is destructive. Pass { confirm: true } in tool args to proceed.",
    },
    {
      name: "immich_delete_tag",
      args: { id: UUID_A },
      refusal: "immich_delete_tag is destructive. Pass { confirm: true } in tool args to proceed.",
    },
    {
      name: "immich_empty_trash",
      args: {},
      refusal: "immich_empty_trash is destructive. Pass { confirm: true } in tool args to proceed.",
    },
  ])("$name returns current refusal shape before any SDK call", async ({ name, args, refusal }) => {
    const result = await callTool(server, name, args);

    expect(result).toEqual({
      isError: true,
      content: [{ type: "text", text: refusal }],
    });
    expect(sdkCalls).toEqual([]);
  });

  it("immich_restore_by_query with no filters returns its custom refusal before any SDK call", async () => {
    const result = await callTool(server, "immich_restore_by_query", {});

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "immich_restore_by_query with no filter would restore all trashed assets. Pass { confirm: true } to proceed, or add a takenAfter/takenBefore/type filter.",
        },
      ],
    });
    expect(sdkCalls).toEqual([]);
  });
});

describe("golden result and payload shape contracts", () => {
  let server: McpServer;

  beforeEach(() => {
    resetFakeSdk();
    server = makeServer(cfgRead);
  });

  it("pins current success payload shape for representative tools", async () => {
    mockSdkResponse("pingServer", { res: "pong" });
    mockSdkResponse("getServerStatistics", { photos: 12, videos: 3 });
    mockSdkResponse("searchAssets", { assets: { items: [{ id: UUID_A, type: "IMAGE" }], total: 1 } });
    mockSdkResponse("getAllTags", [{ id: UUID_A, value: "family" }]);
    mockSdkResponse("getAssetDuplicates", [{ duplicateId: "dup-1", assets: [{ id: UUID_A }, { id: UUID_B }] }]);

    expect(parsedPayload(await callTool(server, "immich_ping"))).toEqual({ res: "pong" });
    expect(parsedPayload(await callTool(server, "immich_get_server_statistics"))).toEqual({ photos: 12, videos: 3 });
    expect(parsedPayload(await callTool(server, "immich_list_assets", { size: 1 }))).toEqual({
      assets: { items: [{ id: UUID_A, type: "IMAGE" }], total: 1 },
    });
    expect(parsedPayload(await callTool(server, "immich_list_tags"))).toEqual([{ id: UUID_A, value: "family" }]);
    expect(parsedPayload(await callTool(server, "immich_list_duplicates"))).toEqual([
      { duplicateId: "dup-1", assets: [{ id: UUID_A }, { id: UUID_B }] },
    ]);
  });

  it("pins current dry-run payload shape with no SDK calls for duplicate resolution", async () => {
    const result = await callTool(server, "immich_resolve_duplicates", {
      keep: [UUID_A],
      discard: [UUID_B],
    });

    expect(parsedPayload(result)).toEqual({
      dryRun: true,
      keep: [UUID_A],
      discard: [UUID_B],
      deleted: 0,
    });
    expect(sdkCalls).toEqual([]);
  });
});
