import { main } from "./server.js";

main().catch((err) => {
  console.error("[wireboard-mcp] fatal:", err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
