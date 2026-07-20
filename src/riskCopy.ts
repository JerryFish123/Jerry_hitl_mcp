import type { ApprovalTicket } from "./types.js";
import {
  formatBlastRadiusBlock,
  formatBlastRadiusSections,
  parseBlastRadiusFromTicket,
} from "./blastRadius.js";
import {
  DANGEROUS_OP_RULES,
  getRuleById,
  type DangerousOpRule,
} from "./policy.js";
import type { RiskLevel } from "./types.js";
import {
  formatRiskDisplay,
  formatRiskTierZh,
  riskRank,
  type RiskLevelOrNone,
} from "./riskLabels.js";

export const RISK_LABEL_ZH: Record<RiskLevel, string> = {
  critical: "可能造成不可逆损失或大范围影响",
  high: "可能丢失数据、破坏环境或产生难以回滚的副作用",
  medium: "有一定副作用，建议确认范围后再执行",
  low: "影响相对有限",
};

const FALLBACK_IMPACT =
  "若未拦截，Agent 可能对项目、数据或外部环境产生不可预期的修改。";
const FALLBACK_IF_APPROVED =
  "批准后 Agent 将继续执行；未批准前不会执行。";

/** Cursor form fields truncate long single-line text — keep form copy short. */
const FORM_TEXT_MAX = 96;

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
  const skip = new Set([
    "matched_rules",
    "intent",
    "params_hash",
    "code_context",
    "context_factors",
    "risk_level_zh",
    "risk_tier",
    "blast_radius",
    "execution_report",
    "execution_comparison",
    "execution_at",
  ]);
  const lines: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (skip.has(k) || v == null) continue;
    if (Array.isArray(v)) {
      lines.push(
        `${k}: ${v.slice(0, 5).join(", ")}${v.length > 5 ? "…" : ""}`,
      );
    } else if (typeof v === "object") {
      lines.push(`${k}: ${JSON.stringify(v).slice(0, 80)}`);
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
  return `约 ${min} 分钟内有效`;
}

function clipFormText(text: string, max = FORM_TEXT_MAX): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max - 1)}…`;
}

/** Plain-text path list (chat / risk_brief). Newlines OK outside Cursor form. */
function formatPathList(paths: string[], empty = "• （无）"): string {
  if (!paths.length) return empty;
  const shown = paths.slice(0, 12);
  const lines = shown.map((p) => `• ${p}`);
  if (paths.length > shown.length) {
    lines.push(`• …另 ${paths.length - shown.length} 项`);
  }
  return lines.join("\n");
}

const FORM_PATH_MAX = 12;

/**
 * Cursor flattens newlines inside one field into a horizontal run.
 * Emit one read-only field per path so the form stacks them vertically.
 */
function pathFieldsForForm(
  prefix: string,
  sectionTitle: string,
  paths: string[],
  opts?: { note?: string; emptyText?: string },
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const note = opts?.note;
  const emptyText = opts?.emptyText ?? "（未提供路径）";

  if (!paths.length) {
    fields[`${prefix}_hdr`] = infoField(sectionTitle, emptyText, note);
    return fields;
  }

  const shown = paths.slice(0, FORM_PATH_MAX);
  fields[`${prefix}_hdr`] = infoField(
    `${sectionTitle}（${paths.length}）`,
    note ?? "下列路径逐条竖排；请逐项确认",
  );
  shown.forEach((p, i) => {
    fields[`${prefix}_${i}`] = infoField(
      `${i + 1}/${shown.length}`,
      p,
    );
  });
  if (paths.length > shown.length) {
    fields[`${prefix}_more`] = infoField(
      "…",
      `另有 ${paths.length - shown.length} 项未展开`,
    );
  }
  return fields;
}

export interface ApprovalSections {
  operation: string;
  paramsLines: string[];
  riskType: string;
  riskLevel: string;
  riskTierZh: string;
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
    riskTierZh: formatRiskTierZh(ticket.risk as RiskLevelOrNone),
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
  lines.push(`说明：${sections.riskLabel}`);
  return lines.join("\n");
}

function riskSectionTitle(sections: ApprovalSections): string {
  return `⛔ 危险性 · ${sections.riskTierZh}`;
}

function formatTicketBlock(sections: ApprovalSections): string {
  return joinBlocks([
    `工单：${sections.ticketId}`,
    sections.expiresHint,
    "关闭弹窗或未选择视为拒绝；未批准前 Agent 不得执行副作用。",
  ]);
}

function formatWhatBlock(sections: ApprovalSections): string {
  const params = formatParamsBlock(sections.paramsLines);
  return params
    ? `${sections.operation}\n${params}`
    : sections.operation;
}

export interface ApprovalBrief {
  message: string;
  risk_brief_zh: string;
}

/** Read-only info block for MCP form elicitation (Cursor renders each field separately). */
function infoField(
  title: string,
  text: string,
  description?: string,
): Record<string, unknown> {
  return {
    type: "string",
    title,
    ...(description ? { description } : {}),
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
 * Structured form for IDE elicitation.
 * Hierarchy: what → risk → consequence → blast paths → means → decide.
 * Keep field count low so decision stays on screen; skip noisy heuristic tests.
 */
export function buildElicitApprovalForm(
  ticket: ApprovalTicket,
): ElicitApprovalForm {
  const sections = buildApprovalSections(ticket);
  const blast = parseBlastRadiusFromTicket(ticket);
  const blastSections = blast ? formatBlastRadiusSections(blast) : null;
  const blastBlock = blast ? formatBlastRadiusBlock(blast) : null;

  const plannedPaths = blast?.planned_files ?? [];
  const extraAffected = (blast?.affected_files ?? []).filter(
    (f) => !plannedPaths.includes(f),
  );

  const blastFields: Record<string, unknown> = blastSections
    ? {
        ...pathFieldsForForm(
          "_blast_planned",
          "爆炸半径 · 拟改",
          plannedPaths,
          {
            note: blastSections.note,
            emptyText: "（未提供路径）",
          },
        ),
        ...(extraAffected.length
          ? pathFieldsForForm(
              "_blast_affected",
              "爆炸半径 · 可能波及",
              extraAffected,
            )
          : {}),
      }
    : {};

  const properties: Record<string, unknown> = {
    _section_what: infoField("本次操作", formatWhatBlock(sections)),
    _section_risk: infoField(
      riskSectionTitle(sections),
      formatRiskBlock(sections),
      "请先确认危险等级，再决定是否批准",
    ),
    _section_impact: infoField(
      "若不拦截的后果",
      clipFormText(sections.impact, 120),
    ),
    ...blastFields,
    _section_approve: infoField(
      "审批通过意味着",
      clipFormText(sections.ifApproved, 100),
    ),
    decision: {
      type: "string",
      title: "您的决定",
      description: `${sections.ticketId} · ${sections.expiresHint} · 不确定请选拒绝`,
      enum: ["reject", "approve"],
      enumNames: ["拒绝（不执行）", "审批通过并继续执行"],
      default: "reject",
    },
    reason: {
      type: "string",
      title: "备注（可选）",
      description: "拒绝时可填写原因",
    },
  };

  const risk_brief_zh = [
    `【${sections.riskType}】风险 ${ticket.risk}`,
    `后果：${sections.impact}`,
    `若批准：${sections.ifApproved}`,
    blastBlock ? `\n${blastBlock}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    message: `⛔ HITL · ${sections.riskTierZh} · ${sections.riskType}`,
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
  const blast = parseBlastRadiusFromTicket(ticket);
  const blastBlock = blast ? formatBlastRadiusBlock(blast) : null;

  const message = joinBlocks([
    `⛔ HITL · ${sections.riskTierZh} · ${sections.riskType}`,
    joinBlocks([
      joinBlocks(["【本次操作】", formatWhatBlock(sections)]),
      joinBlocks([riskSectionTitle(sections), formatRiskBlock(sections)]),
      joinBlocks(["【若不拦截的后果】", sections.impact]),
      blastBlock ? joinBlocks(["【爆炸半径】", blastBlock]) : "",
      joinBlocks(["【审批通过意味着】", sections.ifApproved]),
      joinBlocks(["【工单信息】", formatTicketBlock(sections)]),
    ]),
    "请选择「拒绝（不执行）」或「审批通过并继续执行」。不确定时请拒绝。",
  ]);

  const risk_brief_zh = [
    `【${sections.riskType}】风险 ${ticket.risk}`,
    `后果：${sections.impact}`,
    `若批准：${sections.ifApproved}`,
    blastBlock ? `\n${blastBlock}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return { message, risk_brief_zh };
}
