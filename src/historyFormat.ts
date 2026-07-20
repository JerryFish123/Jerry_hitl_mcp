import type { ApprovalTicket, ApprovalStatus } from "./types.js";
import { formatRiskDisplay, type RiskLevelOrNone } from "./riskLabels.js";
import { formatClosureStatus } from "./blastRadius.js";

const STATUS_ZH: Record<ApprovalStatus, string> = {
  pending: "待审批",
  approved: "已批准",
  rejected: "已拒绝",
  expired: "已过期",
  cancelled: "已取消",
};

const DECIDED_BY_ZH: Record<string, string> = {
  client: "IDE 用户",
  cursor: "IDE 用户",
  web: "网页面板",
  cli: "CLI",
};

const REASON_ZH: Record<string, string> = {
  approved_via_client_elicitation: "IDE 表单批准",
  approved_via_cursor_elicitation: "IDE 表单批准",
  approved_by_human: "人工批准",
  rejected_via_client_elicitation: "IDE 表单拒绝",
  rejected_via_cursor_elicitation: "IDE 表单拒绝",
  rejected_by_human: "人工拒绝",
  declined_via_client_elicitation: "IDE 表单拒绝",
  declined_via_cursor_elicitation: "IDE 表单拒绝",
  cancelled_via_client_elicitation: "关闭弹窗/取消",
  cancelled_via_cursor_elicitation: "关闭弹窗/取消",
  ttl_expired: "工单过期",
};

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

function truncate(value: string, max: number): string {
  const s = value.trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

export function formatHistoryTime(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDecidedBy(
  decidedBy: ApprovalTicket["decided_by"],
): string {
  if (!decidedBy) return "—";
  return DECIDED_BY_ZH[decidedBy] ?? decidedBy;
}

export function formatDecisionReason(ticket: ApprovalTicket): string {
  if (ticket.status === "pending") return "等待审批";
  if (ticket.status === "expired") return "超时未处理";
  const raw = ticket.decision_reason?.trim();
  if (!raw) {
    return ticket.status === "approved" ? "—" : "—";
  }
  return REASON_ZH[raw] ?? raw;
}

export interface HistoryTableRow {
  time: string;
  ticket_id: string;
  action: string;
  summary: string;
  risk: string;
  requester: string;
  approver: string;
  status: string;
  reason: string;
  closure: string;
}

export function toHistoryTableRow(ticket: ApprovalTicket): HistoryTableRow {
  const time = formatHistoryTime(ticket.decided_at ?? ticket.created_at);
  return {
    time,
    ticket_id: ticket.ticket_id,
    action: ticket.action,
    summary: truncate(ticket.summary, 40),
    risk: formatRiskDisplay(ticket.risk as RiskLevelOrNone),
    requester: ticket.requester?.trim() || "—",
    approver: formatDecidedBy(ticket.decided_by),
    status: STATUS_ZH[ticket.status] ?? ticket.status,
    reason: formatDecisionReason(ticket),
    closure: formatClosureStatus(ticket),
  };
}

export function buildHistoryMarkdownTable(
  tickets: ApprovalTicket[],
): string {
  if (tickets.length === 0) return "暂无审批记录。";

  const headers = [
    "时间",
    "工单",
    "操作类型",
    "摘要",
    "风险",
    "操作人",
    "审批人",
    "状态",
    "案卷/对照",
    "原因/备注",
  ];
  const rows = tickets.map((t) => {
    const r = toHistoryTableRow(t);
    return [
      r.time,
      r.ticket_id,
      r.action,
      r.summary,
      r.risk,
      r.requester,
      r.approver,
      r.status,
      r.closure,
      r.reason,
    ].map(escapeCell);
  });

  const sep = headers.map(() => "---");
  const lines = [
    `| ${headers.join(" | ")} |`,
    `| ${sep.join(" | ")} |`,
    ...rows.map((cells) => `| ${cells.join(" | ")} |`),
  ];
  return lines.join("\n");
}

export function buildHistorySummaryZh(
  allCount: number,
  shownCount: number,
  counts: Record<string, number>,
  tableMd: string,
): string {
  return [
    `共 ${allCount} 条（本页展示 ${shownCount} 条，按时间倒序）`,
    `统计：待审 ${counts.pending} / 已批 ${counts.approved} / 已拒 ${counts.rejected} / 过期 ${counts.expired}`,
    "",
    tableMd,
  ].join("\n");
}

export { STATUS_ZH };
