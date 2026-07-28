// Fixture for tests/tier-registry.test.ts: proves the AST scanner recurses
// into locally declared helpers when deriving a server.tool handler's access
// tier.
//
// This file is included by tsconfig.json (`tests/**/*.ts`) so the TypeScript
// program exposes it as a SourceFile, but it is NOT under src/tools, so the
// production scan in deriveTiers() skips it (keeping the production total at
// 74). The scanner is purely syntactic; nothing here executes.
//
// Patterns covered:
//   - fixture_write_tool delegates to a local arrow-function helper that calls
//     requireWrites. The scanner must recurse into the helper to derive
//     "safe-write".
//   - fixture_confirm_tool delegates to a local function helper that gates on
//     an inline `confirm !== true` guard AND calls requireConfirm. The scanner
//     must recurse into the helper to derive "destructive".

type ToolCb = (args?: { confirm?: boolean }) => Promise<unknown>;

interface FixtureServer {
  tool(name: string, description: string, schema: Record<string, never>, cb: ToolCb): void;
}

const server: FixtureServer = {
  tool(_name, _description, _schema, _cb) {
    // no-op: the scanner never invokes handlers.
  },
};

function requireWrites(): void {
  // stub of src/tools/_util.ts requireWrites
}

function requireConfirm(_toolName: string, _confirm: boolean | undefined): void {
  // stub of src/tools/_util.ts requireConfirm
}

// Local helper that gates on writes. The handler delegates to it, so the
// scanner must recurse into the helper body to find requireWrites.
const writeHelper = async (): Promise<unknown> => {
  requireWrites();
  return null;
};

// Local helper that conditionally gates on confirm. The handler delegates to
// it, so the scanner must recurse into the helper body to find the inline
// `confirm !== true` guard and the requireConfirm call.
function confirmHelper(confirm: boolean | undefined): Promise<unknown> {
  if (confirm !== true) {
    requireConfirm("fixture_confirm_tool", confirm);
  }
  return Promise.resolve(null);
}

server.tool(
  "fixture_write_tool",
  "Delegates to a local helper that calls requireWrites.",
  {},
  async () => writeHelper(),
);

server.tool(
  "fixture_confirm_tool",
  "Delegates to a local helper that conditionally calls requireConfirm.",
  {},
  async (args) => confirmHelper(args?.confirm),
);
