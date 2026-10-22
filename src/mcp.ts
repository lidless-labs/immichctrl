import { operatorErrorMessage } from "@lidless-labs/effect-operator-kit";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getConfig } from "./config.js";
import { initImmichClient } from "./client.js";
import { createMcpServer } from "./server.js";
import { redact } from "./security.js";

/** Start the existing stdio mode, or explicitly opt into HTTP. */
export async function serve(http = false): Promise<void> {
  if (http) {
    const { startHttpServer } = await import("./http.js");
    await startHttpServer();
    return;
  }
  const config = getConfig();
  initImmichClient(config);
  const server = createMcpServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/** MCP process fatal boundary: kit message extraction, repo-owned fatal prefix. */
export function reportMcpFatalError(error: unknown): never {
  console.error(`immich-mcp fatal: ${redact(operatorErrorMessage(error))}`);
  process.exit(1);
}
