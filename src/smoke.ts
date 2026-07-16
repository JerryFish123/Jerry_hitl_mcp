/**
 * Offline smoke test (no Cursor): assess_and_gate + approve/reject paths.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
if (!ops.count || Number(ops.count) < 5) {
  throw new Error("dangerous ops catalog too small");
}

// assess + auto gate (no mcp → pending fallback, no elicitation)
const gated = await assessAndGate(store, {
  intent: "帮我把仓库里的 .env 都删掉",
  action: "delete_files",
  params: { dry_run: true },
  requester: "smoke-assess",
});
const assessment = gated.assessment as { requires_approval: boolean; risk: string };
if (!assessment.requires_approval) {
  throw new Error("expected .env delete to require approval");
}
const ticket = gated.ticket as { ticket_id: string; status: string };
if (!ticket?.ticket_id || ticket.status !== "pending") {
  throw new Error("expected auto-created pending ticket");
}
console.log("assess_and_gate", ticket.ticket_id, assessment.risk);

const safe = await assessAndGate(store, {
  intent: "帮我解释一下什么是 HITL",
  auto_create: true,
});
const safeA = safe.assessment as { requires_approval: boolean };
if (safeA.requires_approval || safe.ticket) {
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
