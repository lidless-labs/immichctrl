import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { reportMcpFatalError, serve } from "./mcp.js";

export { reportMcpFatalError, serve } from "./mcp.js";

// True when this module is the process entrypoint. process.argv[1] is often a
// symlink (npm installs the bin as a link); resolve it before comparing so the
// back-compat direct-run of index.js still starts the server.
const isEntrypoint = (() => {
  const arg = process.argv[1];
  if (typeof arg !== "string") return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(arg)).href;
  } catch {
    return false;
  }
})();

if (isEntrypoint) {
  serve(process.argv.includes("--http")).catch(reportMcpFatalError);
}
