import { reportMcpFatalError, serve } from "./mcp.js";

serve(process.argv.includes("--http")).catch(reportMcpFatalError);
