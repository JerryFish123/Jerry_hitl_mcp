import type { ApprovalStore } from "./store.js";
import type {
  ApprovalStatus,
  ApprovalTicket,
  CreateApprovalInput,
} from "./types.js";
import { assessRisk, listDangerousOpsPublic } from "./policy.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { elicitApprovalDecision } from "./elicit.js";

function panelEnabled(): boolean {
  const v = (process.env.HITL_ENABLE_PANEL ?? "0").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function elicitEnabled(): boolean {
  const v = (process.env.HITL_ELICIT ?? "1").trim().toLowerCase();
  return v !== "0" && v !== "false" && v !== "no";
}

export function ticketPublicView(
  store: ApprovalStore,
  ticket: ApprovalTicket,
): Record<string, unknown> {
  return {
    ticket_id: ticket.ticket_id,
    status: ticket.status,
    action: ticket.action,
    summary: ticket.summary,
    risk: ticket.risk,
    params: ticket.params,
    params_hash: ticket.params_hash,
    requester: ticket.requester ?? null,
    created_at: ticket.created_at,
    expires_at: ticket.expires_at,
    decided_at: ticket.decided_at ?? null,
    decision_reason: ticket.decision_reason ?? null,
    decided_by: ticket.decided_by ?? null,
    panel_url: panelEnabled() ? store.getPanelUrl(ticket.ticket_id) : null,
    can_execute: ticket.status === "approved",
    must_stop:
      ticket.status === "rejected" ||
      ticket.status === "expired" ||
      ticket.status === "cancelled",
  };
}

function pendingFallbackPrompt(
  store: ApprovalStore,
  ticket: ApprovalTicket,
  elicitError?: string,
): { next_step: string; user_prompt_zh: string } {
  const view = ticketPublicView(store, ticket);
  if (panelEnabled() && view.panel_url) {
    return {
      next_step:
        "Cursor elicitation unavailable or timed out. Tell the user IN CHAT to open panel_url, approve/reject, then reply. Do NOT execute until get_approval_status returns approved.",
      user_prompt_zh: [
        "⚠️ 该操作需要人工审批，我还不会执行。",
        elicitError
          ? `（Cursor 内确认暂时不可用：${elicitError}）`
          : "",
        `请打开审批面板完成确认：${view.panel_url}`,
        "在面板中点击「批准并继续」或「拒绝」。",
        "完成后请在对话里回复「已批准」或「已拒绝」，我再继续。",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }
  return {
    next_step:
      "Cursor elicitation unavailable. Ask the user to retry the tool call (so the in-IDE form can appear), or set HITL_ENABLE_PANEL=1 for the web panel. Do NOT execute while pending.",
    user_prompt_zh: [
      "⚠️ 该操作需要人工审批，我还不会执行。",
      elicitError
        ? `Cursor 内确认弹窗未出现或失败：${elicitError}`
        : "请在 Cursor 弹出的审批表单中选择批准或拒绝。",
      "若没有弹出表单：请重试该操作，或在 MCP 配置里设置 HITL_ENABLE_PANEL=1 使用网页面板。",
      "在工单变为 approved 之前我不会执行。",
    ].join("\n"),
  };
}

export function createApproval(
  store: ApprovalStore,
  input: CreateApprovalInput,
): Record<string, unknown> {
  if (!input.action?.trim()) {
    throw new Error("action is required");
  }
  if (!input.summary?.trim()) {
    throw new Error("summary is required");
  }
  const ticket = store.create(input);
  const fallback = pendingFallbackPrompt(store, ticket);
  return {
    ...ticketPublicView(store, ticket),
    message:
      "Approval ticket created (pending). Prefer Cursor elicitation via assess_and_gate; otherwise use panel/chat fallback.",
    next_step: fallback.next_step,
    user_prompt_zh: fallback.user_prompt_zh,
  };
}

export function getApprovalStatus(
  store: ApprovalStore,
  ticketId: string,
): Record<string, unknown> {
  const ticket = store.get(ticketId);
  if (!ticket) {
    throw new Error(`ticket_not_found: ${ticketId}`);
  }
  return ticketPublicView(store, ticket);
}

export function listPendingApprovals(
  store: ApprovalStore,
): Record<string, unknown> {
  const tickets = store.listPending();
  return {
    count: tickets.length,
    tickets: tickets.map((t) => ticketPublicView(store, t)),
  };
}

const STATUS_ZH: Record<string, string> = {
  pending: "待审批",
  approved: "已批准",
  rejected: "已拒绝",
  expired: "已过期",
  cancelled: "已取消",
};

/**
 * Approval audit history for chat: "看审批记录" / list past decisions.
 */
export function listApprovalHistory(
  store: ApprovalStore,
  input?: {
    status?: ApprovalStatus | "all";
    limit?: number;
  },
): Record<string, unknown> {
  const status = input?.status ?? "all";
  const limit = Math.max(1, Math.min(input?.limit ?? 20, 100));
  const all = store.list({ status });
  const sliced = all.slice(0, limit);

  const counts = {
    pending: 0,
    approved: 0,
    rejected: 0,
    expired: 0,
    cancelled: 0,
  };
  for (const t of store.list({ status: "all" })) {
    if (t.status in counts) {
      counts[t.status as keyof typeof counts] += 1;
    }
  }

  const records = sliced.map((t) => {
    const view = ticketPublicView(store, t);
    return {
      ...view,
      line_zh: [
        STATUS_ZH[t.status] ?? t.status,
        t.ticket_id,
        t.action,
        t.summary.slice(0, 80),
        t.risk,
        t.decided_by ? `via ${t.decided_by}` : "",
        t.decided_at ?? t.created_at,
      ]
        .filter(Boolean)
        .join(" · "),
    };
  });

  const summary_zh =
    records.length === 0
      ? "暂无审批记录。"
      : [
          `共 ${all.length} 条（本页展示 ${records.length} 条，按时间倒序）`,
          `统计：待审 ${counts.pending} / 已批 ${counts.approved} / 已拒 ${counts.rejected} / 过期 ${counts.expired}`,
          "",
          ...records.map((r, i) => `${i + 1}. ${r.line_zh}`),
        ].join("\n");

  return {
    count: all.length,
    shown: records.length,
    filter: { status, limit },
    counts,
    records,
    summary_zh,
    next_step:
      "Present summary_zh to the user in chat (or a readable table). Do not invent records.",
  };
}

/**
 * Built-in risk assessment + optional auto ticket + Cursor elicitation.
 */
export async function assessAndGate(
  store: ApprovalStore,
  input: {
    intent: string;
    action?: string;
    params?: Record<string, unknown>;
    auto_create?: boolean;
    ttl_seconds?: number;
    requester?: string;
  },
  opts?: { mcp?: Server },
): Promise<Record<string, unknown>> {
  if (!input.intent?.trim()) {
    throw new Error("intent is required");
  }

  const assessment = assessRisk({
    intent: input.intent,
    action: input.action,
  });

  const autoCreate = input.auto_create !== false;
  let ticketView: Record<string, unknown> | null = null;
  let approval_channel: "cursor" | "panel" | "pending" | "none" = "none";
  let next_step =
    "No HITL gate required by built-in policy. You may proceed with caution.";
  let user_prompt_zh: string | null = null;

  if (assessment.requires_approval && autoCreate) {
    const risk = assessment.risk === "none" ? "high" : assessment.risk;
    const created = store.create({
      action: assessment.suggested_action,
      summary: input.intent.trim().slice(0, 500),
      params: {
        ...(input.params ?? {}),
        matched_rules: assessment.matched_rules,
        intent: input.intent.trim(),
      },
      risk,
      ttl_seconds: input.ttl_seconds,
      requester: input.requester ?? "assess_and_gate",
    });

    if (elicitEnabled() && opts?.mcp) {
      const outcome = await elicitApprovalDecision(
        opts.mcp,
        store,
        created.ticket_id,
      );
      ticketView = ticketPublicView(store, outcome.ticket);
      if (outcome.ok) {
        approval_channel = "cursor";
        if (outcome.ticket.status === "approved") {
          next_step =
            "User approved in Cursor elicitation UI. You MAY proceed (prefer dry-run). No need to open a browser.";
          user_prompt_zh = null;
        } else {
          next_step =
            "User rejected/cancelled in Cursor elicitation UI. STOP. Do not execute.";
          user_prompt_zh =
            "用户已在 Cursor 审批表单中拒绝或取消，我不会执行该操作。";
        }
      } else {
        const fb = pendingFallbackPrompt(
          store,
          outcome.ticket,
          outcome.reason,
        );
        approval_channel = panelEnabled() ? "panel" : "pending";
        next_step = fb.next_step;
        user_prompt_zh = fb.user_prompt_zh;
      }
    } else {
      const fb = pendingFallbackPrompt(store, created);
      ticketView = ticketPublicView(store, created);
      approval_channel = panelEnabled() ? "panel" : "pending";
      next_step = fb.next_step;
      user_prompt_zh = fb.user_prompt_zh;
    }
  }

  return {
    assessment: {
      requires_approval: assessment.requires_approval,
      risk: assessment.risk,
      matched_rules: assessment.matched_rules,
      suggested_action: assessment.suggested_action,
      rationale: assessment.rationale,
    },
    ticket: ticketView,
    approval_channel,
    next_step,
    user_prompt_zh,
    policy_ref: "builtin/SKILL.md + src/policy.ts",
  };
}

export function listDangerousOps(): Record<string, unknown> {
  return {
    count: listDangerousOpsPublic().length,
    operations: listDangerousOpsPublic(),
    policy_ref: "builtin/SKILL.md + src/policy.ts",
  };
}

export { panelEnabled, elicitEnabled };
