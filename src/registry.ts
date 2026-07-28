// Access-tier registry for the Immich MCP server.
//
// SAFETY INVARIANT: the tier is a SECOND surface of a fact the executor already
// enforces through its own gates (requireConfirm / requireWrites in
// src/tools/_util.ts). It is descriptive metadata, never the enforcement
// point. A tool is safe because its executor calls the gate, not because this
// map labels it.
//
// The duplication is only safe because tests/tier-registry.test.ts derives each
// tool's tier INDEPENDENTLY from the executor source and asserts this map
// agrees. Do not edit these tiers by hand without re-running that test; a tier
// map that silently disagrees with the gates is worse than no tier map.
//
// The createToolRegistry pattern is inlined here because
// @lidless-labs/mcp-dynamic-tools is unpublished and must not be added as a
// dependency.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export type ToolTier = "read" | "safe-write" | "destructive";

// Standard MCP tool annotations. Hints only: clients must not rely on them
// for security. Clients implementing human-in-the-loop approval read
// destructiveHint to decide which calls need a human, and readOnlyHint to
// skip approval on pure reads.
export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
}

// Projected from the tier as a pure function, so annotations can never
// disagree with the tier.
export function annotationsForTier(tier: ToolTier): ToolAnnotations {
  switch (tier) {
    case "read":
      return { readOnlyHint: true };
    case "safe-write":
      return { readOnlyHint: false, destructiveHint: false };
    case "destructive":
      return { readOnlyHint: false, destructiveHint: true };
  }
}

export interface ToolRegistry {
  readonly tiers: Readonly<Record<string, ToolTier>>;
  /** Throws when the name has no declared tier, so a new tool cannot ship untiered. */
  tierFor(name: string): ToolTier;
  annotationsFor(name: string): ToolAnnotations;
  /**
   * Fail-closed startup guard: every registered tool must declare a tier, and
   * the registry must not name a tool that is not registered. Call this once
   * at server start, before serving any request.
   */
  assertNoDrift(registeredNames: readonly string[]): void;
}

export function createToolRegistry(tiers: Record<string, ToolTier>): ToolRegistry {
  const frozen = Object.freeze({ ...tiers });
  const tierFor = (name: string): ToolTier => {
    const tier = frozen[name];
    if (tier === undefined) {
      throw new Error(`registry: no access tier declared for tool "${name}"`);
    }
    return tier;
  };
  return {
    tiers: frozen,
    tierFor,
    annotationsFor: (name) => annotationsForTier(tierFor(name)),
    assertNoDrift(registeredNames) {
      const registered = new Set(registeredNames);
      const declared = new Set(Object.keys(frozen));
      const missing = [...registered].filter((n) => !declared.has(n));
      const extra = [...declared].filter((n) => !registered.has(n));
      if (missing.length > 0 || extra.length > 0) {
        throw new Error(
          `registry/tool drift: missing tier for [${missing.join(", ")}]; ` +
            `tier declared for unregistered [${extra.join(", ")}]`,
        );
      }
    },
  };
}

// Every Immich MCP tool, conservatively tiered from the actual executor gates
// in src/tools/*.ts:
//   requireConfirm  => destructive
//   requireWrites   => safe-write (unless requireConfirm also present)
//   neither         => read
// `immich_delete_asset`, `immich_resolve_duplicates`, `immich_restore_by_query`,
// `immich_run_job`, and `immich_resolve_with_keep_strategy` gate only some
// execution paths on confirmation, but are tiered at their conservative maximum.
const IMMICH_TOOL_TIERS: Record<string, ToolTier> = {
  // system.ts
  immich_ping: "read",
  immich_get_server_info: "read",
  immich_get_server_statistics: "read",
  immich_get_capabilities: "read",
  immich_get_storage: "read",

  // assets.ts
  immich_list_assets: "read",
  immich_get_asset: "read",
  immich_get_asset_exif: "read",
  immich_download_asset_original: "read",
  immich_download_asset_thumbnail: "read",
  immich_get_asset_statistics: "read",
  immich_upload_asset_from_path: "safe-write",
  immich_update_asset: "safe-write",
  immich_bulk_update_assets: "destructive",
  immich_delete_asset: "destructive",
  immich_restore_from_trash: "safe-write",

  // search.ts
  immich_search_metadata: "read",
  immich_search_smart: "read",
  immich_search_explore: "read",

  // albums.ts
  immich_list_albums: "read",
  immich_get_album: "read",
  immich_get_album_statistics: "read",
  immich_create_album: "safe-write",
  immich_update_album: "safe-write",
  immich_delete_album: "destructive",
  immich_add_assets_to_album: "safe-write",
  immich_remove_assets_from_album: "safe-write",

  // people.ts
  immich_list_people: "read",
  immich_get_person: "read",
  immich_get_person_assets: "read",
  immich_update_person: "safe-write",
  immich_hide_person: "safe-write",
  immich_merge_people: "destructive",
  immich_suggest_face_names: "read",

  // tags.ts
  immich_list_tags: "read",
  immich_get_tag: "read",
  immich_create_tag: "safe-write",
  immich_update_tag: "safe-write",
  immich_delete_tag: "destructive",
  immich_add_tag_to_assets: "safe-write",
  immich_remove_tag_from_assets: "safe-write",

  // shared-links.ts
  immich_list_shared_links: "read",
  immich_get_shared_link: "read",
  immich_create_shared_link: "safe-write",
  immich_update_shared_link: "safe-write",
  immich_delete_shared_link: "destructive",

  // activities.ts
  immich_list_activities: "read",
  immich_create_activity: "safe-write",
  immich_delete_activity: "destructive",
  immich_get_activity_statistics: "read",

  // memories.ts
  immich_list_memories: "read",
  immich_get_memory: "read",

  // duplicates.ts
  immich_list_duplicates: "read",
  immich_resolve_duplicates: "destructive",

  // stacks.ts
  immich_list_stacks: "read",
  immich_create_stack: "safe-write",
  immich_update_stack: "safe-write",
  immich_delete_stack: "destructive",

  // duplicate-flows.ts
  immich_categorize_duplicates: "read",
  immich_find_byte_dupes: "read",
  immich_resolve_with_keep_strategy: "destructive",
  immich_explain_duplicate_group: "read",
  immich_find_clip_dupes: "read",
  immich_compare_assets: "read",
  immich_audit_active: "read",
  immich_audit_trash: "safe-write",

  // memory-flows.ts
  immich_memories_today: "read",
  immich_daily_digest: "read",

  // album-flows.ts
  immich_search_then_album: "safe-write",

  // trash.ts
  immich_list_trash: "read",
  immich_restore_by_query: "destructive",
  immich_empty_trash: "destructive",

  // jobs.ts
  immich_list_jobs: "read",
  immich_run_job: "destructive",
};

export const TOOL_REGISTRY: ToolRegistry = createToolRegistry(IMMICH_TOOL_TIERS);

/**
 * Stamp every registered tool's annotations from the registry. Call once at
 * server start, AFTER all register*Tools calls and BEFORE the transport is
 * created/connected. Fails closed: asserts no drift between the declared
 * tiers and the actual registered tool names BEFORE any annotation update,
 * so a new tool cannot ship untiered and a stale tier cannot survive a
 * rename/removal silently.
 */
export function finalizeToolRegistry(server: McpServer): void {
  const registered = (
    server as unknown as {
      _registeredTools: Record<string, { update(updates: { annotations?: ToolAnnotations }): void }>;
    }
  )._registeredTools;
  if (!registered || typeof registered !== "object") {
    throw new Error("registry: server has no _registeredTools map to finalize");
  }
  const names = Object.keys(registered);
  TOOL_REGISTRY.assertNoDrift(names);
  for (const name of names) {
    const tool = registered[name];
    if (!tool || typeof tool.update !== "function") {
      throw new Error(`registry: registered tool "${name}" has no update() hook`);
    }
    tool.update({ annotations: TOOL_REGISTRY.annotationsFor(name) });
  }
}
