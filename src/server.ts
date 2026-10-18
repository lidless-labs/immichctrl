import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getConfig, type Config } from "./config.js";
import { registerSystemTools } from "./tools/system.js";
import { registerAssetTools } from "./tools/assets.js";
import { registerSearchTools } from "./tools/search.js";
import { registerAlbumTools } from "./tools/albums.js";
import { registerPeopleTools } from "./tools/people.js";
import { registerTagTools } from "./tools/tags.js";
import { registerSharedLinkTools } from "./tools/shared-links.js";
import { registerActivityTools } from "./tools/activities.js";
import { registerMemoryTools } from "./tools/memories.js";
import { registerDuplicateTools } from "./tools/duplicates.js";
import { registerStackTools } from "./tools/stacks.js";
import { registerDuplicateFlowTools } from "./tools/duplicate-flows.js";
import { registerMemoryFlowTools } from "./tools/memory-flows.js";
import { registerAlbumFlowTools } from "./tools/album-flows.js";
import { registerTrashTools } from "./tools/trash.js";
import { registerJobTools } from "./tools/jobs.js";
import { finalizeToolRegistry } from "./registry.js";

// One fresh server and tool registry per MCP session. SDK initialization is process-owned.
export function createMcpServer(config: Config = getConfig()): McpServer {
  const server = new McpServer({
    name: "immich-mcp",
    version: "0.1.0",
    description:
      "MCP server for Immich. Browse and search photos, manage albums, recognize people, surface memories, resolve duplicates, manage stacks, share links, and comment on activity, all as typed tool calls.",
  });

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

  // Stamp each registered tool's access-tier annotations from the registry,
  // AFTER all registrations and BEFORE the transport is created/connected.
  // assertNoDrift fails closed if a tool was added/removed/renamed without
  // updating src/registry.ts.
  finalizeToolRegistry(server);

  return server;
}
