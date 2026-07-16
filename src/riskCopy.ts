import type { ApprovalTicket } from "./types.js";
import {
  DANGEROUS_OP_RULES,
  getRuleById,
  type DangerousOpRule,
} from "./policy.js";
import type { RiskLevel } from "./types.js";

export const RISK_LABEL_ZH: Record<RiskLevel, string> = {
  critical: "严重 — 可能造成不可逆损失或大范围影响，通常无法一键撤销",
  high: "高 — 可能丢失数据、破坏环境或产生难以回滚的副作用",
  medium: "中 — 有一定副作用，建议确认范围后再执行",
  low: "低 — 影响相对有限，但仍需人工确认",
};

const FALLBACK_IMPACT =
  "若未拦截，Agent 可能对项目、数据或外部环境产生不可预期的修改。";
const FALLBACK_IF_APPROVED =
  "您点「审批通过并继续执行」后，Agent 将按上述摘要继续执行该操作；未批准前不会执行。";

const GENERIC_RULE: Pick<
  DangerousOpRule,
  "title" | "impact_zh" | "if_approved_zh"
> = {
  title: "敏感/有副作用的操作",
  impact_zh: FALLBACK_IMPACT,
  if_approved_zh: FALLBACK_IF_APPROVED,
};

function riskRank(r: RiskLevel): number {
  switch (r) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
  }
}

export function pickPrimaryRule(
  matchedRuleIds: string[],
  ticketRisk: RiskLevel,
): DangerousOpRule | typeof GENERIC_RULE {
  let best: DangerousOpRule | undefined;
  for (const id of matchedRuleIds) {
    const rule = getRuleById(id);
    if (!rule) continue;
    if (!best || riskRank(rule.risk) >= riskRank(best.risk)) {
      best = rule;
    }
  }
  if (best) return best;

  const byAction = DANGEROUS_OP_RULES.find((r) => r.risk === ticketRisk);
  return byAction ?? GENERIC_RULE;
}

function matchedIdsFromTicket(ticket: ApprovalTicket): string[] {
  const raw = ticket.params?.matched_rules;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((m) => (typeof m === "object" && m && "id" in m ? String(m.id) : ""))
    .filter(Boolean);
}

function formatParamsBrief(params: Record<string, unknown>): string | null {
  const skip = new Set([
    "matched_rules",
    "intent",
    "params_hash",
  ]);
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (skip.has(k) || v == null) continue;
    if (Array.isArray(v)) {
      parts.push(`${k}: ${v.slice(0, 5).join(", ")}${v.length > 5 ? "…" : ""}`);
    } else if (typeof v === "object") {
      parts.push(`${k}: ${JSON.stringify(v).slice(0, 120)}`);
    } else {
      parts.push(`${k}: ${String(v)}`);
    }
  }
  return parts.length ? parts.join("\n") : null;
}

function expiresHint(expiresAt: string): string {
  const ms = Date.parse(expiresAt) - Date.now();
  if (Number.isNaN(ms) || ms <= 0) return "工单可能已接近或已过有效期。";
  const min = Math.max(1, Math.round(ms / 60_000));
  return `本工单约 ${min} 分钟内有效；过期后需重新申请。`;
}

export interface ApprovalBrief {
  message: string;
  risk_brief_zh: string;
}

/**
 * Shared copy for IDE elicitation popup and assess_and_gate tool response.
 */
export function buildApprovalBrief(ticket: ApprovalTicket): ApprovalBrief {
  const matchedIds = matchedIdsFromTicket(ticket);
  const rule = pickPrimaryRule(matchedIds, ticket.risk);
  const impact =
    "impact_zh" in rule && rule.impact_zh ? rule.impact_zh : FALLBACK_IMPACT;
  const ifApproved =
    "if_approved_zh" in rule && rule.if_approved_zh
      ? rule.if_approved_zh
      : FALLBACK_IF_APPROVED;
  const paramsBrief = formatParamsBrief(ticket.params);
  const otherRules =
    matchedIds.length > 1
      ? matchedIds
          .filter((id) => id !== ("id" in rule ? rule.id : ""))
          .map((id) => getRuleById(id)?.title ?? id)
          .join("、")
      : "";

  const riskLabel = RISK_LABEL_ZH[ticket.risk] ?? ticket.risk;

  const message = [
    "⚠️ HITL 人工审批确认",
    "",
    "【本次操作】",
    ticket.summary,
    ...(paramsBrief ? ["", "关键参数：", paramsBrief] : []),
    "",
    "【危险性】",
    `类型：${rule.title}`,
    `等级：${ticket.risk.toUpperCase()} — ${riskLabel}`,
    ...(otherRules ? [`还匹配：${otherRules}`] : []),
    "",
    "【若不拦截的后果】",
    impact,
    "",
    "【审批通过意味着】",
    ifApproved,
    "",
    `工单：${ticket.ticket_id}`,
    expiresHint(ticket.expires_at),
    "",
    "请在下方选择「拒绝（不执行）」或「审批通过并继续执行」。",
    "关闭弹窗或未选择视为拒绝；未批准前 Agent 不得执行副作用。",
  ].join("\n");

  const risk_brief_zh = [
    `【${rule.title}】风险 ${ticket.risk}`,
    `后果：${impact}`,
    `若批准：${ifApproved}`,
  ].join("\n");

  return { message, risk_brief_zh };
}
