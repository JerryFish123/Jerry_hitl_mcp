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
  submitExecutionReport,
} from "./service.js";
import { buildBlastRadiusBrief, buildExecutionComparison, pathsMatch } from "./blastRadius.js";
import { runInit } from "./cli/init.js";
import { SERVER_INSTRUCTIONS } from "./serverInstructions.js";

function uniqForSmoke(items: string[]): string[] {
  return [...new Set(items)].sort();
}

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
  blast_radius?: { planned_files: string[]; heuristic: boolean };
};
if (!assessment.gate_required) {
  throw new Error("expected .env delete to require gate");
}
if (!assessment.blast_radius?.planned_files?.includes(".env")) {
  throw new Error("expected blast_radius planned_files to include .env");
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

const closed = submitExecutionReport(store, {
  ticket_id: String(ticket.ticket_id),
  actual_files: [".env"],
  verify_runs: [{ command: "vitest run .env.test.ts", passed: true }],
  params_hash: String(status.params_hash),
});
if (!String(closed.summary_zh).includes("参数哈希")) {
  throw new Error("execution report should mention params hash");
}
if (closed.closure_status !== "已对照") {
  throw new Error("closure_status should be 已对照");
}

try {
  submitExecutionReport(store, {
    ticket_id: String(ticket.ticket_id),
    actual_files: [".env"],
  });
  throw new Error("duplicate execution report should be rejected");
} catch (e) {
  if (!String(e).includes("execution_report_already_submitted")) {
    throw e;
  }
}

if (!pathsMatch(".env", "/proj/.env")) {
  throw new Error("pathsMatch should treat .env and /proj/.env as same file");
}
const pathCmp = buildExecutionComparison(
  store.get(String(ticket.ticket_id))!,
  { actual_files: ["/proj/.env"] },
);
if (
  pathCmp.missing_from_actual.length ||
  pathCmp.extra_in_actual.length
) {
  throw new Error("normalized path comparison should not false-positive missing/extra");
}

const scopeBrief = buildBlastRadiusBrief({
  assessment: ctxDelete,
  planned_changes: { files: [".env"] },
});
scopeBrief.affected_files = uniqForSmoke([
  ".env",
  "src/config.ts",
  "src/util.ts",
]);
const scopeTicket = store.create({
  action: "delete_files",
  summary: "delete env",
  params: { blast_radius: scopeBrief },
});
store.resolve(scopeTicket.ticket_id, "approved", { decided_by: "cli" });
const scopeCmp = buildExecutionComparison(scopeTicket, {
  actual_files: [".env"],
});
if (scopeCmp.planned_scope.length !== 1 || scopeCmp.planned_scope[0] !== ".env") {
  throw new Error("planned_scope should only include planned_files");
}
if (scopeCmp.missing_from_actual.length || scopeCmp.extra_in_actual.length) {
  throw new Error("scope-only planned_files should match .env actual");
}

const brief = buildBlastRadiusBrief({
  assessment: ctxDelete,
  code_context: {
    files: ["src/services/userService.ts"],
    active_file: "src/services/userService.ts",
  },
  planned_changes: { files: ["src/services/userService.ts"] },
});
if (!brief.affected_tests.some((t) => t.includes("userService"))) {
  throw new Error("blast radius should guess userService tests");
}

const t2 = createApproval(store, {
  action: "git_force_push",
  summary: "Force push main",
  params: { ref: "main" },
  risk: "critical",
});
const t2Params = t2.params as { blast_radius?: { summary_zh?: string } };
if (!t2Params?.blast_radius?.summary_zh) {
  throw new Error("createApproval should attach blast_radius brief");
}
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
if (!String(history.summary_zh).includes("案卷/对照")) {
  throw new Error("history table should include closure column");
}

if (!SERVER_INSTRUCTIONS.includes("assess_and_gate")) {
  throw new Error("server instructions missing assess_and_gate");
}

const initDir = fs.mkdtempSync(path.join(os.tmpdir(), "hitl-init-"));
const initDry = runInit({ cwd: initDir, dryRun: true });
if (!initDry.ok || initDry.written.length < 2) {
  throw new Error("init dry-run should plan rule+skill");
}
const initReal = runInit({ cwd: initDir });
if (!initReal.ok || initReal.written.length < 2) {
  throw new Error("init should write rule+skill");
}
if (
  !fs.existsSync(path.join(initDir, ".cursor/rules/hitl-auto-gate.mdc")) ||
  !fs.existsSync(path.join(initDir, ".cursor/skills/hitl-gate/SKILL.md"))
) {
  throw new Error("init files missing on disk");
}
const initSkip = runInit({ cwd: initDir });
if (initSkip.skipped.length < 2) {
  throw new Error("init without --force should skip existing files");
}

console.log("smoke ok", {
  dataDir,
  assessed: ticket.ticket_id,
  rejected: t2.ticket_id,
  catalog: ops.count,
  history_shown: history.shown,
  init_written: initReal.written.length,
});
