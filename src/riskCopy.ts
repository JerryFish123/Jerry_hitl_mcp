import type { ApprovalTicket } from "./types.js";
import {
  DANGEROUS_OP_RULES,
  getRuleById,
  type DangerousOpRule,
} from "./policy.js";
import type { RiskLevel } from "./types.js";
import { formatRiskDisplay, riskRank, type RiskLevelOrNone } from "./riskLabels.js";

export const RISK_LABEL_ZH: Record<RiskLevel, string> = {
  critical: "致命危险 — 可能造成不可逆损失或大范围影响",
  high: "高危险 — 可能丢失数据、破坏环境或产生难以回滚的副作用",
  medium: "中危险 — 有一定副作用，建议确认范围后再执行",
  low: "低危险 — 影响相对有限",
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

function riskRankLocal(r: RiskLevel): number {
  return riskRank(r as RiskLevelOrNone);
}

export function pickPrimaryRule(
  matchedRuleIds: string[],
  ticketRisk: RiskLevel,
): DangerousOpRule | typeof GENERIC_RULE {
  let best: DangerousOpRule | undefined;
  for (const id of matchedRuleIds) {
    const rule = getRuleById(id);
    if (!rule) continue;
    if (!best || riskRankLocal(rule.risk) >= riskRankLocal(best.risk)) {
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

function formatParamsLines(params: Record<string, unknown>): string[] {
  const skip = new Set(["matched_rules", "intent", "params_hash"]);
  const lines: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (skip.has(k) || v == null) continue;
    if (Array.isArray(v)) {
      lines.push(
        `${k}: ${v.slice(0, 5).join(", ")}${v.length > 5 ? "…" : ""}`,
      );
    } else if (typeof v === "object") {
      lines.push(`${k}: ${JSON.stringify(v).slice(0, 120)}`);
    } else {
      lines.push(`${k}: ${String(v)}`);
    }
  }
  return lines;
}

function expiresHint(expiresAt: string): string {
  const ms = Date.parse(expiresAt) - Date.now();
  if (Number.isNaN(ms) || ms <= 0) return "工单可能已接近或已过有效期。";
  const min = Math.max(1, Math.round(ms / 60_000));
  return `本工单约 ${min} 分钟内有效；过期后需重新申请。`;
}

export interface ApprovalSections {
  operation: string;
  paramsLines: string[];
  riskType: string;
  riskLevel: string;
  riskLabel: string;
  otherRules: string | null;
  impact: string;
  ifApproved: string;
  ticketId: string;
  expiresHint: string;
}

export function buildApprovalSections(
  ticket: ApprovalTicket,
): ApprovalSections {
  const matchedIds = matchedIdsFromTicket(ticket);
  const rule = pickPrimaryRule(matchedIds, ticket.risk);
  const impact =
    "impact_zh" in rule && rule.impact_zh ? rule.impact_zh : FALLBACK_IMPACT;
  const ifApproved =
    "if_approved_zh" in rule && rule.if_approved_zh
      ? rule.if_approved_zh
      : FALLBACK_IF_APPROVED;
  const otherRules =
    matchedIds.length > 1
      ? matchedIds
          .filter((id) => id !== ("id" in rule ? rule.id : ""))
          .map((id) => getRuleById(id)?.title ?? id)
          .join("、")
      : null;

  return {
    operation: ticket.summary,
    paramsLines: formatParamsLines(ticket.params),
    riskType: rule.title,
    riskLevel: formatRiskDisplay(ticket.risk as RiskLevelOrNone),
    riskLabel: RISK_LABEL_ZH[ticket.risk] ?? ticket.risk,
    otherRules,
    impact,
    ifApproved,
    ticketId: ticket.ticket_id,
    expiresHint: expiresHint(ticket.expires_at),
  };
}

function joinBlocks(blocks: string[]): string {
  return blocks.filter(Boolean).join("\n\n");
}

function formatParamsBlock(lines: string[]): string {
  if (!lines.length) return "";
  return lines.map((line) => `• ${line}`).join("\n");
}

function formatRiskBlock(sections: ApprovalSections): string {
  const lines = [
    `等级：${sections.riskLevel}`,
    `类型：${sections.riskType}`,
  ];
  if (sections.otherRules) {
    lines.push(`还匹配：${sections.otherRules}`);
  }
  return lines.join("\n");
}

function formatTicketBlock(sections: ApprovalSections): string {
  return joinBlocks([
    `工单：${sections.ticketId}`,
    sections.expiresHint,
    "关闭弹窗或未选择视为拒绝；未批准前 Agent 不得执行副作用。",
  ]);
}

export interface ApprovalBrief {
  message: string;
  risk_brief_zh: string;
}

/** Read-only info block for MCP form elicitation (Cursor renders each field separately). */
function infoField(title: string, text: string): Record<string, unknown> {
  return {
    type: "string",
    title,
    default: text,
    readOnly: true,
  };
}

export interface ElicitApprovalForm {
  message: string;
  requestedSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
  risk_brief_zh: string;
}

/**
 * Structured form for IDE elicitation: short header + labeled read-only sections.
 */
export function buildElicitApprovalForm(
  ticket: ApprovalTicket,
): ElicitApprovalForm {
  const sections = buildApprovalSections(ticket);
  const paramsBlock = formatParamsBlock(sections.paramsLines);

  const properties: Record<string, unknown> = {
    _section_operation: infoField("【本次操作】", sections.operation),
    ...(paramsBlock
      ? { _section_params: infoField("【关键参数】", paramsBlock) }
      : {}),
    _section_risk: infoField("【危险性】", formatRiskBlock(sections)),
    _section_impact: infoField("【若不拦截的后果】", sections.impact),
    _section_approve: infoField("【审批通过意味着】", sections.ifApproved),
    _section_ticket: infoField("【工单信息】", formatTicketBlock(sections)),
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
  };

  const risk_brief_zh = [
    `【${sections.riskType}】风险 ${ticket.risk}`,
    `后果：${sections.impact}`,
    `若批准：${sections.ifApproved}`,
  ].join("\n");

  return {
    message: "⚠️ HITL 人工审批确认",
    requestedSchema: {
      type: "object",
      properties,
      required: ["decision"],
    },
    risk_brief_zh,
  };
}

/**
 * Plain-text fallback (double newlines between blocks for clients that only show message).
 */
export function buildApprovalBrief(ticket: ApprovalTicket): ApprovalBrief {
  const sections = buildApprovalSections(ticket);
  const paramsBlock = formatParamsBlock(sections.paramsLines);

  const message = joinBlocks([
    "⚠️ HITL 人工审批确认",
    joinBlocks([
      "【本次操作】",
      sections.operation,
      paramsBlock ? joinBlocks(["【关键参数】", paramsBlock]) : "",
      joinBlocks(["【危险性】", formatRiskBlock(sections)]),
      joinBlocks(["【若不拦截的后果】", sections.impact]),
      joinBlocks(["【审批通过意味着】", sections.ifApproved]),
      joinBlocks(["【工单信息】", formatTicketBlock(sections)]),
    ]),
    "请在下方选择「拒绝（不执行）」或「审批通过并继续执行」。",
  ]);

  const risk_brief_zh = [
    `【${sections.riskType}】风险 ${ticket.risk}`,
    `后果：${sections.impact}`,
    `若批准：${sections.ifApproved}`,
  ].join("\n");

  return { message, risk_brief_zh };
}
