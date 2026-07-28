// Server-side search metadata for Immich MCP tools.
//
// These terms are deliberately separate from MCP tool descriptors: clients
// must continue to see only the public name, description, schema, and access
// annotations. Step 4 will consume this table when deferred loading is added.

export const DOMAINS = Object.freeze([
  "system",
  "assets",
  "search",
  "albums",
  "people",
  "tags",
  "sharing",
  "activities",
  "memories",
  "duplicates",
  "stacks",
  "trash",
  "jobs",
] as const);

export type Domain = (typeof DOMAINS)[number];

export interface ToolSearchMeta {
  readonly domain: Domain;
  readonly keywords: readonly string[];
}

const entry = (domain: Domain, keywords: readonly string[]): ToolSearchMeta =>
  Object.freeze({ domain, keywords: Object.freeze([...keywords]) });

export const TOOL_SEARCH_META: Readonly<Record<string, ToolSearchMeta>> = Object.freeze({
  // system.ts
  immich_ping: entry("system", ["healthcheck", "reachable", "alive"]),
  immich_get_server_info: entry("system", ["configuration", "branding", "authentication"]),
  immich_get_server_statistics: entry("system", ["totals", "census", "headcount"]),
  immich_get_capabilities: entry("system", ["modules", "availability", "support"]),
  immich_get_storage: entry("system", ["disk", "capacity", "quota"]),

  // assets.ts
  immich_list_assets: entry("assets", ["library", "browse", "inventory"]),
  immich_get_asset: entry("assets", ["details", "record", "item"]),
  immich_get_asset_exif: entry("assets", ["camera", "lens", "shooting"]),
  immich_download_asset_original: entry("assets", ["source", "fullsize", "export"]),
  immich_download_asset_thumbnail: entry("assets", ["preview", "small", "poster"]),
  immich_get_asset_statistics: entry("assets", ["breakdown", "media", "totals"]),
  immich_upload_asset_from_path: entry("assets", ["ingest", "import", "filesystem"]),
  immich_update_asset: entry("assets", ["edit", "modify", "curate"]),
  immich_bulk_update_assets: entry("assets", ["batch", "mass", "many"]),
  immich_delete_asset: entry("assets", ["remove", "erase", "discard"]),
  immich_restore_from_trash: entry("assets", ["recover", "undelete", "rescue"]),

  // search.ts
  immich_search_metadata: entry("search", ["faceted", "attributes", "constraints"]),
  immich_search_smart: entry("search", ["conceptual", "meaning", "similarity"]),
  immich_search_explore: entry("search", ["discover", "serendipity", "randomized"]),

  // albums.ts and album-flows.ts
  immich_list_albums: entry("albums", ["collections", "browse", "catalog"]),
  immich_get_album: entry("albums", ["collection", "details", "contents"]),
  immich_get_album_statistics: entry("albums", ["inventory", "breakdown", "summary"]),
  immich_create_album: entry("albums", ["new", "collection", "organize"]),
  immich_update_album: entry("albums", ["retitle", "artwork", "caption"]),
  immich_delete_album: entry("albums", ["remove", "discard", "dissolve"]),
  immich_add_assets_to_album: entry("albums", ["include", "attach", "collect"]),
  immich_remove_assets_from_album: entry("albums", ["detach", "exclude", "unfile"]),
  immich_search_then_album: entry("albums", ["curate", "collection", "workflow"]),

  // people.ts
  immich_list_people: entry("people", ["faces", "identities", "browse"]),
  immich_get_person: entry("people", ["identity", "profile", "details"]),
  immich_get_person_assets: entry("people", ["appearances", "portraits", "sightings"]),
  immich_update_person: entry("people", ["retitle", "birthday", "discoverability"]),
  immich_hide_person: entry("people", ["conceal", "suppress", "exclude"]),
  immich_merge_people: entry("people", ["combine", "deduplicate", "consolidate"]),
  immich_suggest_face_names: entry("people", ["triage", "unidentified", "rank"]),

  // tags.ts
  immich_list_tags: entry("tags", ["labels", "taxonomy", "browse"]),
  immich_get_tag: entry("tags", ["label", "details", "assignment"]),
  immich_create_tag: entry("tags", ["label", "classify", "organize"]),
  immich_update_tag: entry("tags", ["retitle", "palette", "revise"]),
  immich_delete_tag: entry("tags", ["remove", "discard", "unlabel"]),
  immich_add_tag_to_assets: entry("tags", ["apply", "label", "classify"]),
  immich_remove_tag_from_assets: entry("tags", ["detach", "unlabel", "clear"]),

  // shared-links.ts
  immich_list_shared_links: entry("sharing", ["shares", "public", "browse"]),
  immich_get_shared_link: entry("sharing", ["share", "details", "access"]),
  immich_create_shared_link: entry("sharing", ["publish", "guest", "access"]),
  immich_update_shared_link: entry("sharing", ["revise", "expiry", "password"]),
  immich_delete_shared_link: entry("sharing", ["revoke", "disable", "unpublish"]),

  // activities.ts
  immich_list_activities: entry("activities", ["reactions", "discussion", "timeline"]),
  immich_create_activity: entry("activities", ["respond", "engage", "feedback"]),
  immich_delete_activity: entry("activities", ["remove", "moderate", "erase"]),
  immich_get_activity_statistics: entry("activities", ["engagement", "totals", "reactions"]),

  // memories.ts and memory-flows.ts
  immich_list_memories: entry("memories", ["nostalgia", "anniversary", "flashback"]),
  immich_get_memory: entry("memories", ["flashback", "reminiscence", "story"]),
  immich_memories_today: entry("memories", ["anniversary", "flashback", "nostalgia"]),
  immich_daily_digest: entry("memories", ["briefing", "recap", "roundup"]),

  // duplicates.ts and duplicate-flows.ts
  immich_list_duplicates: entry("duplicates", ["copies", "repeats", "redundancy"]),
  immich_resolve_duplicates: entry("duplicates", ["dedupe", "keeper", "prune"]),
  immich_categorize_duplicates: entry("duplicates", ["classify", "bucket", "taxonomy"]),
  immich_find_byte_dupes: entry("duplicates", ["bitwise", "fingerprint", "clone"]),
  immich_resolve_with_keep_strategy: entry("duplicates", ["consolidation", "keeper", "policy"]),
  immich_explain_duplicate_group: entry("duplicates", ["reasoning", "why", "evidence"]),
  immich_find_clip_dupes: entry("duplicates", ["perceptual", "similarity", "near match"]),
  immich_compare_assets: entry("duplicates", ["difference", "contrast", "choose"]),
  immich_audit_active: entry("duplicates", ["savings", "hygiene", "waste"]),
  immich_audit_trash: entry("duplicates", ["unmatched", "validation", "crosscheck"]),

  // stacks.ts
  immich_list_stacks: entry("stacks", ["groupings", "bursts", "pairs"]),
  immich_create_stack: entry("stacks", ["bundle", "group", "sequence"]),
  immich_update_stack: entry("stacks", ["leader", "lead", "cover"]),
  immich_delete_stack: entry("stacks", ["ungroup", "dissolve", "separate"]),

  // trash.ts
  immich_list_trash: entry("trash", ["recycle bin", "deleted", "browse"]),
  immich_restore_by_query: entry("trash", ["recover", "undelete", "rescue"]),
  immich_empty_trash: entry("trash", ["purge", "wipe", "erase"]),

  // jobs.ts
  immich_list_jobs: entry("jobs", ["queues", "workers", "asynchronous"]),
  immich_run_job: entry("jobs", ["trigger", "execute", "dispatch"]),
});
