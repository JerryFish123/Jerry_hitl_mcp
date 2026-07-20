/**
 * Offline smoke test (no Cursor): assess_and_gate + approve/reject paths.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assessRisk } from "./policy.js";
import { ApprovalStore } from "./store.js";
import {
  assessAndGate,
  createApproval,
  getApprovalStatus,
  listApprovalHistory,
  listDangerousOps,
  listPendingApprovals,
} from "./service.js";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hitl-smoke-"));
const store = new ApprovalStore({
  dataDir,
  panelBaseUrl: "http://127.0.0.1:8787",
});

const ops = listDangerousOps();
if (!ops.count || Number(ops.count) < 10) {
  throw new Error("dangerous ops catalog too small");
}

// 五档 + 仅 high/critical 触发闸门
const mediumPush = assessRisk({
  intent: "帮我把 feature 分支 git push 到 origin",
});
if (mediumPush.risk !== "medium" || mediumPush.gate_required) {
  throw new Error("git push should be medium without gate");
}
if (mediumPush.risk_level_zh !== "中危险") {
  throw new Error("risk_level_zh mismatch for medium");
}

const safe = assessRisk({ intent: "帮我解释一下什么是 HITL" });
if (safe.gate_required || safe.risk_tier > 2) {
  throw new Error("explain intent should be low/none without gate");
}

const ctxDelete = assessRisk({
  intent: "删除这个 env 文件",
  code_context: {
    active_file: "/proj/.env",
    files: [".env"],
    summary: "当前打开的是含 API_KEY 的 .env",
  },
});
if (!ctxDelete.gate_required || ctxDelete.risk_tier < 4) {
  throw new Error("delete .env with context should gate");
}

// assess + auto gate (no mcp → pending fallback, no elicitation)
const gated = await assessAndGate(store, {
  intent: "帮我把仓库里的 .env 都删掉",
  action: "delete_files",
  params: { dry_run: true },
  code_context: { files: [".env"] },
  requester: "smoke-assess",
});
const assessment = gated.assessment as {
  gate_required: boolean;
  risk: string;
  risk_level_zh: string;
};
if (!assessment.gate_required) {
  throw new Error("expected .env delete to require gate");
}
if (assessment.risk_level_zh !== "高危险" && assessment.risk_level_zh !== "致命危险") {
  throw new Error("expected high/critical tier for delete .env");
}
const ticket = gated.ticket as { ticket_id: string; status: string };
if (!ticket?.ticket_id || ticket.status !== "pending") {
  throw new Error("expected auto-created pending ticket");
}
console.log("assess_and_gate", ticket.ticket_id, assessment.risk_level_zh);

const safeGate = await assessAndGate(store, {
  intent: "帮我解释一下什么是 HITL",
  auto_create: true,
});
const safeA = safeGate.assessment as { gate_required: boolean };
if (safeA.gate_required || safeGate.ticket) {
  throw new Error("safe intent should not create ticket");
}

const pending = listPendingApprovals(store);
if (Number(pending.count) < 1) {
  throw new Error("expected at least 1 pending");
}

store.resolve(ticket.ticket_id, "approved", {
  decided_by: "cli",
  reason: "smoke_ok",
});
const status = getApprovalStatus(store, ticket.ticket_id);
if (!status.can_execute) {
  throw new Error("can_execute should be true");
}

const t2 = createApproval(store, {
  action: "git_force_push",
  summary: "Force push main",
  params: { ref: "main" },
  risk: "critical",
});
store.resolve(String(t2.ticket_id), "rejected", {
  reason: "too dangerous",
  decided_by: "cli",
});
const rejected = getApprovalStatus(store, String(t2.ticket_id));
if (!rejected.must_stop || rejected.status !== "rejected") {
  throw new Error("reject path failed");
}

const history = listApprovalHistory(store, { limit: 10 });
if (Number(history.shown) < 2 || !String(history.summary_zh).includes("|")) {
  throw new Error("list_approval_history table failed");
}

console.log("smoke ok", {
  dataDir,
  assessed: ticket.ticket_id,
  rejected: t2.ticket_id,
  catalog: ops.count,
  history_shown: history.shown,
});
