#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  assessAndGate,
  createApproval,
  elicitEnabled,
  getApprovalStatus,
  listApprovalHistory,
  listDangerousOps,
  listPendingApprovals,
  panelEnabled,
  ticketPublicView,
} from "./service.js";
import { getSharedStore } from "./store.js";
import { startPanelServer } from "./web/server.js";
import { elicitApprovalDecision } from "./elicit.js";

const riskSchema = z.enum(["low", "medium", "high", "critical"]);
const historyStatusSchema = z.enum([
  "all",
  "pending",
  "approved",
  "rejected",
  "expired",
  "cancelled",
]);

function textResult(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ ok: false, error: message }, null, 2),
      },
    ],
    isError: true,
  };
}

async function main(): Promise<void> {
  const store = getSharedStore();

  if (panelEnabled()) {
    const port = Number(process.env.HITL_PANEL_PORT ?? "8787");
    try {
      await startPanelServer(store, { port, host: "127.0.0.1" });
      console.error(`[hitl_mcp] web panel enabled on :${port}`);
    } catch (err) {
      console.error(
        `[hitl_mcp] panel failed to start on :${port}: ${err instanceof Error ? err.message : err}`,
      );
    }
  } else {
    console.error(
      "[hitl_mcp] web panel OFF (default). Approval via IDE elicitation. Set HITL_ENABLE_PANEL=1 to enable.",
    );
  }

  const server = new McpServer({
    name: "hitl_mcp",
    version: "0.5.0",
  });

  server.tool(
    "assess_and_gate",
    "Assess user intent + optional code_context; returns 5-tier risk (无/低/中/高/致命). ONLY 高危险 & 致命危险 trigger HITL approval. Agent MUST pass code_context (active file, snippets, affected paths) when evaluating code changes. Call BEFORE side effects.",
    {
      intent: z
        .string()
        .describe("User request or proposed action in natural language"),
      action: z
        .string()
        .optional()
        .describe("Optional explicit action id, e.g. delete_files"),
      code_context: z
        .object({
          workspace: z.string().optional(),
          active_file: z.string().optional(),
          files: z.array(z.string()).optional(),
          snippets: z
            .array(
              z.object({
                path: z.string(),
                content: z.string().optional(),
                language: z.string().optional(),
              }),
            )
            .optional(),
          summary: z
            .string()
            .optional()
            .describe("Agent summary of relevant current code / change scope"),
        })
        .optional()
        .describe(
          "Current code context: combine with intent for risk assessment",
        ),
      params: z
        .record(z.unknown())
        .optional()
        .describe("Optional params to lock into the approval ticket"),
      auto_create: z
        .boolean()
        .optional()
        .describe("Auto-create ticket when gate_required (default true)"),
      ttl_seconds: z.number().int().optional(),
      requester: z.string().optional(),
    },
    async (args) => {
      try {
        return textResult(
          await assessAndGate(
            store,
            {
              intent: args.intent,
              action: args.action,
              code_context: args.code_context,
              params: args.params,
              auto_create: args.auto_create,
              ttl_seconds: args.ttl_seconds,
              requester: args.requester,
            },
            { mcp: server.server },
          ),
        );
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "list_dangerous_ops",
    "List the built-in dangerous operation catalog used by assess_and_gate (MCP-embedded policy).",
    {},
    async () => {
      try {
        return textResult(listDangerousOps());
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "request_approval",
    "Manually request human approval (skip assessment). Uses IDE elicitation when available. Prefer assess_and_gate for normal flow.",
    {
      action: z.string().describe("Action name, e.g. delete_files"),
      summary: z.string().describe("One-line human-readable summary"),
      params: z.record(z.unknown()).optional(),
      risk: riskSchema.optional(),
      ttl_seconds: z.number().int().optional(),
      requester: z.string().optional(),
    },
    async (args) => {
      try {
        const created = createApproval(store, {
          action: args.action,
          summary: args.summary,
          params: args.params,
          risk: args.risk,
          ttl_seconds: args.ttl_seconds,
          requester: args.requester,
        });
        const ticketId = String(created.ticket_id);

        if (elicitEnabled()) {
          const outcome = await elicitApprovalDecision(
            server.server,
            store,
            ticketId,
          );
          if (outcome.ok) {
            return textResult({
              ...ticketPublicView(store, outcome.ticket),
              approval_channel: "client",
              risk_brief_zh: outcome.risk_brief_zh,
              message:
                outcome.ticket.status === "approved"
                  ? "Approved in IDE. Agent may proceed."
                  : "Rejected/cancelled in IDE. Agent must stop.",
            });
          }
          return textResult({
            ...created,
            approval_channel: panelEnabled() ? "panel" : "pending",
            elicit_error: outcome.reason,
            risk_brief_zh: outcome.risk_brief_zh,
          });
        }

        return textResult(created);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "get_approval_status",
    "Get approval ticket status. Only proceed when status is approved. Stop when rejected or expired.",
    {
      ticket_id: z.string(),
    },
    async (args) => {
      try {
        return textResult(getApprovalStatus(store, args.ticket_id));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "list_pending",
    "List all pending approval tickets waiting for human decision.",
    {},
    async () => {
      try {
        return textResult(listPendingApprovals(store));
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "list_approval_history",
    "List approval audit history. Call when user asks 看审批记录. Returns summary_zh as markdown TABLE (time, ticket, action, summary, risk, requester, approver, status, reason). Present summary_zh in chat.",
    {
      status: historyStatusSchema
        .optional()
        .describe("Filter by status; default all"),
      limit: z
        .number()
        .int()
        .optional()
        .describe("Max records to return (default 20, max 100)"),
    },
    async (args) => {
      try {
        return textResult(
          listApprovalHistory(store, {
            status: args.status,
            limit: args.limit,
          }),
        );
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
