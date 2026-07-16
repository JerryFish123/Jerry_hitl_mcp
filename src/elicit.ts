import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { ApprovalStore } from "./store.js";
import type { ApprovalTicket } from "./types.js";
import { buildApprovalBrief } from "./riskCopy.js";

export type ElicitOutcome =
  | { ok: true; mode: "client"; ticket: ApprovalTicket; risk_brief_zh: string }
  | {
      ok: false;
      mode: "fallback";
      reason: string;
      ticket: ApprovalTicket;
      risk_brief_zh: string;
    };

/**
 * Ask the MCP client to show an in-IDE approval form.
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
    const { risk_brief_zh } = buildApprovalBrief(current);
    return { ok: true, mode: "client", ticket: current, risk_brief_zh };
  }

  const { message, risk_brief_zh } = buildApprovalBrief(current);

  try {
    const result = await mcp.elicitInput({
      mode: "form",
      message,
      requestedSchema: {
        type: "object",
        properties: {
          decision: {
            type: "string",
            title: "您的决定",
            description: "请选择是否允许 Agent 继续执行上述操作",
            enum: ["approve", "reject"],
            enumNames: ["审批通过并继续执行", "拒绝（不执行）"],
          },
          reason: {
            type: "string",
            title: "备注（可选）",
            description: "拒绝时可填写原因，便于审计记录",
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
          reason: reason || "approved_via_client_elicitation",
          decided_by: "client",
        });
        return { ok: true, mode: "client", ticket, risk_brief_zh };
      }
      const ticket = store.resolve(ticketId, "rejected", {
        reason: reason || "rejected_via_client_elicitation",
        decided_by: "client",
      });
      return { ok: true, mode: "client", ticket, risk_brief_zh };
    }

    const ticket = store.resolve(ticketId, "rejected", {
      reason:
        result.action === "decline"
          ? "declined_via_client_elicitation"
          : "cancelled_via_client_elicitation",
      decided_by: "client",
    });
    return { ok: true, mode: "client", ticket, risk_brief_zh };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const fresh = store.get(ticketId) ?? current;
    const brief = buildApprovalBrief(fresh);
    return {
      ok: false,
      mode: "fallback",
      reason,
      ticket: fresh,
      risk_brief_zh: brief.risk_brief_zh,
    };
  }
}
