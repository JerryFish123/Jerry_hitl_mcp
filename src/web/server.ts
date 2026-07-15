import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ApprovalStore } from "../store.js";
import { ticketPublicView } from "../service.js";
import { openBrowser } from "../openBrowser.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");

export interface PanelOptions {
  host?: string;
  port?: number;
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  const data = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(data);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function contentType(filePath: string): string {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  return "application/octet-stream";
}

function serveStatic(
  res: http.ServerResponse,
  urlPath: string,
): boolean {
  let rel = urlPath === "/" ? "/index.html" : urlPath;
  if (rel.startsWith("/tickets/")) {
    rel = "/index.html";
  }
  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safe);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end("Forbidden");
    return true;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return false;
  }
  res.writeHead(200, { "Content-Type": contentType(filePath) });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

export function startPanelServer(
  store: ApprovalStore,
  opts: PanelOptions = {},
): Promise<{ host: string; port: number; close: () => Promise<void> }> {
  const host = opts.host ?? "127.0.0.1";
  const port = opts.port ?? 8787;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);
    const method = req.method ?? "GET";

    try {
      if (method === "GET" && url.pathname === "/api/health") {
        sendJson(res, 200, { ok: true, service: "hitl_mcp_panel" });
        return;
      }

      if (method === "GET" && url.pathname === "/api/tickets") {
        const status = url.searchParams.get("status") ?? "all";
        const tickets =
          status === "pending"
            ? store.listPending()
            : status === "all"
              ? store.list({ status: "all" })
              : store.list({
                  status: status as
                    | "approved"
                    | "rejected"
                    | "expired"
                    | "cancelled"
                    | "pending",
                });
        sendJson(res, 200, {
          tickets: tickets.map((t) => ticketPublicView(store, t)),
        });
        return;
      }

      const ticketMatch = url.pathname.match(/^\/api\/tickets\/([^/]+)$/);
      if (method === "GET" && ticketMatch) {
        const ticket = store.get(decodeURIComponent(ticketMatch[1]));
        if (!ticket) {
          sendJson(res, 404, { error: "ticket_not_found" });
          return;
        }
        sendJson(res, 200, ticketPublicView(store, ticket));
        return;
      }

      const resolveMatch = url.pathname.match(
        /^\/api\/tickets\/([^/]+)\/resolve$/,
      );
      if (method === "POST" && resolveMatch) {
        const raw = await readBody(req);
        let body: { decision?: string; reason?: string } = {};
        try {
          body = raw ? JSON.parse(raw) : {};
        } catch {
          sendJson(res, 400, { error: "invalid_json" });
          return;
        }
        const decision = body.decision;
        if (decision !== "approved" && decision !== "rejected") {
          sendJson(res, 400, { error: "decision_must_be_approved_or_rejected" });
          return;
        }
        try {
          const ticket = store.resolve(
            decodeURIComponent(resolveMatch[1]),
            decision,
            { reason: body.reason, decided_by: "web" },
          );
          sendJson(res, 200, ticketPublicView(store, ticket));
        } catch (err) {
          sendJson(res, 409, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }

      if (method === "GET" && serveStatic(res, url.pathname)) {
        return;
      }

      sendJson(res, 404, { error: "not_found" });
    } catch (err) {
      sendJson(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const url = `http://${host}:${port}`;
      console.error(`[hitl_mcp] approval panel: ${url}`);
      openBrowser(url);
      resolve({
        host,
        port,
        close: () =>
          new Promise((resClose, rejClose) => {
            server.close((e) => (e ? rejClose(e) : resClose()));
          }),
      });
    });
  });
}
