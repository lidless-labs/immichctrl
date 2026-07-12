import { reportMcpFatalError, serve } from "./index.js";

serve().catch(reportMcpFatalError);
