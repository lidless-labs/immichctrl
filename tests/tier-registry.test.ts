// Immich Runbook Step 2 proof: the access-tier registry must agree with the
// executor gates. This test derives each tool's tier INDEPENDENTLY from the
// TypeScript source of every server.tool handler (scanning requireConfirm,
// inline confirm:true guards, requireWrites, and locally declared helpers), then
// asserts that TOOL_REGISTRY agrees, that drift detection fires, and that
// finalizeToolRegistry stamps the real registered tools' annotations.
//
import { describe, expect, it } from "vitest";
import { installFakeSdk } from "./_fake-sdk.js";

installFakeSdk();

import * as path from "node:path";
import * as url from "node:url";
import { API } from "typescript/unstable/sync";
import * as ts from "typescript/unstable/ast";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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
import { TOOL_REGISTRY, finalizeToolRegistry } from "../src/registry.js";
import type { Config } from "../src/config.js";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const toolsDir = path.join(root, "src", "tools");
const fixturePath = path.join(root, "tests", "fixtures", "tier-registry-fixture.ts");

const testConfig: Config = {
  baseUrl: "https://photos.example.com/api",
  apiKey: "k",
  allowWrites: false,
  verifySsl: true,
};

type Tier = "read" | "safe-write" | "destructive";
type Annotations = { readOnlyHint?: boolean; destructiveHint?: boolean };

const rank = (t: Tier): number => (t === "read" ? 0 : t === "safe-write" ? 1 : 2);
const bump = (a: Tier, b: Tier): Tier => (rank(a) >= rank(b) ? a : b);

// Independently derive the maximum tier of every server.tool handler in a
// single SourceFile by scanning its body for requireConfirm or an inline
// confirm:true guard (destructive), requireWrites (safe-write), and locally
// declared helper calls (recursing into the helper body). Extracted from
// deriveTiers() so the local-helper recursion can be proven against a
// compiler-included fixture without disturbing the production src/tools scan.
function deriveTiersFromSourceFile(sf: ts.SourceFile): Map<string, Tier> {
  const out = new Map<string, Tier>();
  const locals = new Map<string, ts.Node>();
  const collectLocals = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      locals.set(node.name.text, node);
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      locals.set(node.name.text, node.initializer);
    }
    node.forEachChild(collectLocals);
  };
  collectLocals(sf);

  const gateOf = (name: string): Tier | null =>
    name === "requireConfirm"
      ? "destructive"
      : name === "requireWrites"
        ? "safe-write"
        : null;
  const calleeName = (expression: ts.Expression): string | null =>
    ts.isIdentifier(expression) ? expression.text : null;
  const isConfirmReference = (node: ts.Node): boolean =>
    (ts.isIdentifier(node) && node.text === "confirm") ||
    (ts.isPropertyAccessExpression(node) && node.name.text === "confirm");
  const isInlineConfirmGuard = (node: ts.Node): boolean =>
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken) &&
    ((isConfirmReference(node.left) && node.right.kind === ts.SyntaxKind.TrueKeyword) ||
      (node.left.kind === ts.SyntaxKind.TrueKeyword && isConfirmReference(node.right)));

  const scan = (node: ts.Node, seen: Set<string>): Tier => {
    let tier: Tier = "read";
    const visit = (child: ts.Node): void => {
      if (isInlineConfirmGuard(child)) tier = bump(tier, "destructive");
      if (ts.isCallExpression(child)) {
        const name = calleeName(child.expression);
        if (name) {
          const gate = gateOf(name);
          if (gate) {
            tier = bump(tier, gate);
          } else if (locals.has(name) && !seen.has(name)) {
            const next = new Set(seen);
            next.add(name);
            const helper = locals.get(name);
            if (helper) tier = bump(tier, scan(helper, next));
          }
        }
      }
      child.forEachChild(visit);
    };
    visit(node);
    return tier;
  };

  const findToolCalls = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "tool" &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "server"
    ) {
      const args = node.arguments;
      if (args.length >= 2) {
        const nameArg = args[0];
        if (nameArg && ts.isStringLiteral(nameArg)) {
          const callback = args[args.length - 1]!;
          const tier = scan(callback, new Set());
          const prior = out.get(nameArg.text);
          out.set(nameArg.text, prior ? bump(prior, tier) : tier);
        }
      }
    }
    node.forEachChild(findToolCalls);
  };
  findToolCalls(sf);
  return out;
}

// Independently derive the maximum tier of every server.tool handler across the
// production src/tools/*.ts files (excluding _util.ts). The scan is restricted
// to src/tools so compiler-included fixtures under tests/fixtures/ do not
// inflate the production total.
function deriveTiers(): Map<string, Tier> {
  const out = new Map<string, Tier>();
  const api = new API({ cwd: root });
  const snapshot = api.updateSnapshot({
    openProjects: [path.join(root, "tsconfig.json")],
  });
  const project = snapshot.getProject(path.join(root, "tsconfig.json"));
  if (!project) throw new Error("TypeScript did not load the Immich tsconfig");

  try {
    for (const file of project.program.getSourceFileNames()) {
      if (!file.startsWith(`${toolsDir}${path.sep}`) || !file.endsWith(".ts") || file.endsWith("_util.ts")) {
        continue;
      }
      const sf = project.program.getSourceFile(file);
      if (!sf) throw new Error(`TypeScript did not load ${file}`);
      for (const [name, tier] of deriveTiersFromSourceFile(sf)) {
        const prior = out.get(name);
        out.set(name, prior ? bump(prior, tier) : tier);
      }
    }
  } finally {
    snapshot.dispose();
    api.close();
  }
  return out;
}

// Register every production Immich MCP tool onto a real McpServer. Centralized
// so the finalizeToolRegistry tests (positive and fail-closed) register the
// identical 74-tool set the production server does.
function registerAllTools(server: McpServer, config: Config): void {
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
}

const derived = deriveTiers();

describe("tier-registry (Immich Runbook Step 2)", () => {
  it("derives a tier for every one of the 74 server.tool handlers", () => {
    expect(derived.size).toBe(74);
  });

  it("every derived tier matches TOOL_REGISTRY.tierFor", () => {
    for (const [name, tier] of derived) {
      expect(TOOL_REGISTRY.tierFor(name), name).toBe(tier);
    }
  });

  it("TOOL_REGISTRY.tierFor throws for an unknown tool name", () => {
    expect(() => TOOL_REGISTRY.tierFor("immich_does_not_exist")).toThrow();
  });

  it("TOOL_REGISTRY.assertNoDrift passes for the derived name set", () => {
    expect(() => TOOL_REGISTRY.assertNoDrift([...derived.keys()])).not.toThrow();
  });

  it("TOOL_REGISTRY.assertNoDrift throws on a missing (undeclared) registered name", () => {
    expect(() =>
      TOOL_REGISTRY.assertNoDrift([...derived.keys(), "immich_bogus"]),
    ).toThrow();
  });

  it("TOOL_REGISTRY.assertNoDrift throws on a stale (declared but unregistered) name", () => {
    expect(() =>
      TOOL_REGISTRY.assertNoDrift([...derived.keys()].slice(1)),
    ).toThrow();
  });

  it("finalizeToolRegistry stamps every registered tool's annotations from the registry", () => {
    const server = new McpServer({ name: "immich-mcp", version: "0.0.0-test" });
    registerAllTools(server, testConfig);

    finalizeToolRegistry(server);

    const reg = (
      server as unknown as {
        _registeredTools: Record<string, { annotations?: Annotations }>;
      }
    )._registeredTools;
    const names = Object.keys(reg);
    expect(names).toHaveLength(74);
    expect([...names].sort()).toEqual([...derived.keys()].sort());
    for (const name of names) {
      expect(reg[name]!.annotations).toEqual(TOOL_REGISTRY.annotationsFor(name));
    }
  });

  it("finalizeToolRegistry fails closed when a registered tool has no declared tier, before any annotations are stamped", () => {
    const server = new McpServer({ name: "immich-mcp", version: "0.0.0-test" });
    registerAllTools(server, testConfig);

    const reg = (
      server as unknown as {
        _registeredTools: Record<string, { annotations?: Annotations }>;
      }
    )._registeredTools;
    const realNames = Object.keys(reg);
    expect(realNames).toHaveLength(74);

    // Snapshot annotations BEFORE finalize for every real registered tool. The
    // SDK leaves annotations undefined when a tool is registered without an
    // annotations argument, so a fail-closed throw must leave them all untouched.
    const before: Record<string, Annotations | undefined> = {};
    for (const name of realNames) {
      before[name] = reg[name]!.annotations;
      expect(before[name], name).toBeUndefined();
    }

    // Inject an extra registered tool name that has NO declared tier. This
    // simulates a new tool shipping without a registry entry: assertNoDrift
    // must catch it before any annotation stamping runs.
    server.tool(
      "immich_untiered_extra",
      "Registered but intentionally untiered to prove finalize fails closed.",
      {},
      async () => ({ content: [] }),
    );
    expect(Object.keys(reg)).toHaveLength(75);

    expect(() => finalizeToolRegistry(server)).toThrow();

    // No real registered tool received annotations before the throw: the
    // fail-closed guard runs the drift check BEFORE the stamping loop.
    for (const name of realNames) {
      expect(reg[name]!.annotations, name).toBe(before[name]);
      expect(reg[name]!.annotations, name).toBeUndefined();
    }
  });

  it("AST scanner recurses into local helpers (fixture: safe-write + destructive)", () => {
    const api = new API({ cwd: root });
    const snapshot = api.updateSnapshot({
      openProjects: [path.join(root, "tsconfig.json")],
    });
    const project = snapshot.getProject(path.join(root, "tsconfig.json"));
    if (!project) throw new Error("TypeScript did not load the Immich tsconfig");
    try {
      const sf = project.program.getSourceFile(fixturePath);
      if (!sf) throw new Error(`TypeScript did not load fixture ${fixturePath}`);
      const tiers = deriveTiersFromSourceFile(sf);
      expect(tiers.size).toBe(2);
      expect(tiers.get("fixture_write_tool")).toBe("safe-write");
      expect(tiers.get("fixture_confirm_tool")).toBe("destructive");
    } finally {
      snapshot.dispose();
      api.close();
    }
  });
});
