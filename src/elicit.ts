import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { ApprovalStore } from "./store.js";
import type { ApprovalTicket } from "./types.js";

export type ElicitOutcome =
  | { ok: true; mode: "cursor"; ticket: ApprovalTicket }
  | {
      ok: false;
      mode: "fallback";
      reason: string;
      ticket: ApprovalTicket;
    };

/**
 * Ask the MCP client (Cursor) to show an in-IDE approval form.
 * On success, resolves the ticket immediately — no web panel needed.
 */
export async function elicitApprovalDecision(
  mcp: Server,
  store: ApprovalStore,
  ticketId: string,
): Promise<ElicitOutcome> {
  const current = store.get(ticketId);
  if (!current) {
    throw new Error(`ticket_not_found: ${ticketId}`);
  }
  if (current.status !== "pending") {
    return { ok: true, mode: "cursor", ticket: current };
  }

  const message = [
    "⚠️ HITL 审批（Cursor 内确认）",
    `工单：${current.ticket_id}`,
    `操作：${current.action}`,
    `风险：${current.risk}`,
    `摘要：${current.summary}`,
    "",
    "请选择「批准并继续」或「拒绝」。未批准前 Agent 不得执行副作用。",
  ].join("\n");

  try {
    const result = await mcp.elicitInput({
      mode: "form",
      message,
      requestedSchema: {
        type: "object",
        properties: {
          decision: {
            type: "string",
            title: "审批决定",
            description: "批准后 Agent 才能继续执行该危险操作",
            enum: ["approve", "reject"],
            enumNames: ["批准并继续", "拒绝"],
          },
          reason: {
            type: "string",
            title: "备注（可选）",
            description: "拒绝原因或其他说明",
          },
        },
        required: ["decision"],
      },
    });

    if (result.action === "accept") {
      const decision = String(result.content?.decision ?? "");
      const reason =
        typeof result.content?.reason === "string"
          ? result.content.reason
          : undefined;
      if (decision === "approve") {
        const ticket = store.resolve(ticketId, "approved", {
          reason: reason || "approved_via_cursor_elicitation",
          decided_by: "cursor",
        });
        return { ok: true, mode: "cursor", ticket };
      }
      const ticket = store.resolve(ticketId, "rejected", {
        reason: reason || "rejected_via_cursor_elicitation",
        decided_by: "cursor",
      });
      return { ok: true, mode: "cursor", ticket };
    }

    const ticket = store.resolve(ticketId, "rejected", {
      reason:
        result.action === "decline"
          ? "declined_via_cursor_elicitation"
          : "cancelled_via_cursor_elicitation",
      decided_by: "cursor",
    });
    return { ok: true, mode: "cursor", ticket };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const fresh = store.get(ticketId) ?? current;
    return {
      ok: false,
      mode: "fallback",
      reason,
      ticket: fresh,
    };
  }
}
