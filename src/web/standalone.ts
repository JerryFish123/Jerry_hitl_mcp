import { getSharedStore } from "../store.js";
import { startPanelServer } from "./server.js";

const port = Number(process.env.HITL_PANEL_PORT ?? "8787");

const store = getSharedStore();
await startPanelServer(store, { port, host: "127.0.0.1" });
console.error("[hitl_mcp] panel-only mode (no MCP stdio). Ctrl+C to stop.");
