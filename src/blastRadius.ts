import type { CodeContextInput } from "./contextRisk.js";
import type { RiskAssessment } from "./policy.js";
import type { ApprovalTicket } from "./types.js";
import path from "node:path";

export interface BlastRadiusBrief {
  planned_files: string[];
  affected_files: string[];
  affected_tests: string[];
  risk_notes: string[];
  verify_plan: string[];
  summary_zh: string;
  /** MVP 均为路径启发式，非完整静态分析 */
  heuristic: true;
}

export interface PlannedChangesInput {
  files?: string[];
  summary?: string;
}

export interface VerifyRunInput {
  command: string;
  passed?: boolean;
  output?: string;
}

export interface ExecutionReportInput {
  actual_files?: string[];
  verify_runs?: VerifyRunInput[];
  params_hash?: string;
  note?: string;
}

export interface ExecutionComparison {
  planned_scope: string[];
  actual_files: string[];
  missing_from_actual: string[];
  extra_in_actual: string[];
  verify_planned: number;
  verify_ran: number;
  verify_passed: number;
  params_hash_match: boolean | null;
  summary_zh: string;
}

const TEST_SUFFIXES = [
  ".test.ts",
  ".test.tsx",
  ".test.js",
  ".test.jsx",
  ".spec.ts",
  ".spec.tsx",
  ".spec.js",
  ".spec.vue",
];

function uniqSorted(paths: string[]): string[] {
  return [...new Set(paths.map((p) => p.trim()).filter(Boolean))].sort();
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

/** Match relative/absolute/basename variants for plan vs actual comparison. */
export function pathsMatch(a: string, b: string): boolean {
  const na = normalizePath(a);
  const nb = normalizePath(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ba = path.posix.basename(na);
  const bb = path.posix.basename(nb);
  if (ba && ba === bb) return true;
  if (nb.endsWith(`/${na}`) || na.endsWith(`/${nb}`)) return true;
  return false;
}

function findMissingPlanned(planned: string[], actual: string[]): string[] {
  return planned.filter(
    (p) => !actual.some((a) => pathsMatch(p, a)),
  );
}

function findExtraActual(planned: string[], actual: string[]): string[] {
  return actual.filter(
    (a) => !planned.some((p) => pathsMatch(p, a)),
  );
}

function guessTestsForFile(filePath: string): string[] {
  const norm = normalizePath(filePath);
  const dir = path.posix.dirname(norm);
  const base = path.posix.basename(norm);
  const ext = path.posix.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  const guesses: string[] = [];

  for (const suf of TEST_SUFFIXES) {
    guesses.push(path.posix.join(dir, `${stem}${suf}`));
    guesses.push(path.posix.join(dir, "__tests__", `${stem}${suf}`));
  }
  if (ext === ".vue") {
    guesses.push(path.posix.join(dir, `${stem}.spec.ts`));
  }
  return guesses;
}

function guessRelatedFiles(filePath: string): string[] {
  const norm = normalizePath(filePath);
  const dir = path.posix.dirname(norm);
  const base = path.posix.basename(norm);
  const stem = base.replace(/\.[^.]+$/, "");
  const related: string[] = [];

  if (dir !== ".") {
    related.push(path.posix.join(dir, "index.ts"));
    related.push(path.posix.join(dir, "index.js"));
  }
  if (/Service$/i.test(stem)) {
    related.push(path.posix.join(dir, stem.replace(/Service$/i, ".ts")));
    related.push(path.posix.join(dir, stem.replace(/Service$/i, ".js")));
  }
  if (/\.vue$/i.test(norm)) {
    related.push(path.posix.join(dir, `${stem}.ts`));
  }
  return related.filter((p) => p !== norm);
}

function collectPlannedPaths(input: {
  code_context?: CodeContextInput;
  planned_changes?: PlannedChangesInput;
}): string[] {
  const paths: string[] = [];
  if (input.planned_changes?.files?.length) {
    paths.push(...input.planned_changes.files);
  }
  if (input.code_context?.active_file) {
    paths.push(input.code_context.active_file);
  }
  if (input.code_context?.files?.length) {
    paths.push(...input.code_context.files);
  }
  for (const snip of input.code_context?.snippets ?? []) {
    paths.push(snip.path);
  }
  return uniqSorted(paths.map(normalizePath));
}

export function buildBlastRadiusBrief(input: {
  assessment: Pick<
    RiskAssessment,
    "matched_rules" | "context_factors" | "risk_level_zh" | "rationale"
  >;
  code_context?: CodeContextInput;
  planned_changes?: PlannedChangesInput;
}): BlastRadiusBrief {
  const planned_files = collectPlannedPaths(input);
  const related = planned_files.flatMap(guessRelatedFiles);
  const affected_files = uniqSorted([...planned_files, ...related]);

  const affected_tests = uniqSorted(
    planned_files.flatMap(guessTestsForFile),
  ).slice(0, 8);

  const risk_notes: string[] = [
    "（启发式案卷，非完整静态分析/依赖图）",
    ...input.assessment.context_factors,
    ...input.assessment.matched_rules.map((r) => `规则：${r.title}`),
  ];
  if (input.planned_changes?.summary?.trim()) {
    risk_notes.push(input.planned_changes.summary.trim());
  }
  if (input.code_context?.summary?.trim()) {
    risk_notes.push(input.code_context.summary.trim());
  }

  const verify_plan: string[] = [];
  for (const t of affected_tests.slice(0, 4)) {
    verify_plan.push(`vitest run ${t}`);
  }
  if (!verify_plan.length && planned_files.length) {
    verify_plan.push(`npm test -- ${planned_files.slice(0, 2).join(" ")}`);
  }
  if (!verify_plan.length) {
    verify_plan.push("npm test（或项目常用测试命令）");
  }

  const plannedBlock =
    planned_files.length > 0
      ? planned_files.map((f) => `  • ${f}`).join("\n")
      : "  • （未提供路径，请 Agent 传 code_context / planned_changes）";
  const affectedBlock =
    affected_files.length > 0
      ? affected_files
          .slice(0, 8)
          .map((f) => `  • ${f}`)
          .join("\n")
      : "  • （未能推断波及路径）";
  const testBlock =
    affected_tests.length > 0
      ? affected_tests.map((f) => `  • ${f}`).join("\n")
      : "  • （未匹配到同目录测试文件）";
  const verifyBlock = verify_plan.map((c, i) => `  ${i + 1}. ${c}`).join("\n");

  const summary_zh = [
    `【爆炸半径案卷】${input.assessment.risk_level_zh}`,
    `拟改：\n${plannedBlock}`,
    `波及（启发式）：\n${affectedBlock}`,
    `相关测试（启发式）：\n${testBlock}`,
    `建议验证：\n${verifyBlock}`,
    input.assessment.rationale,
  ].join("\n\n");

  return {
    planned_files,
    affected_files: uniqSorted([...planned_files, ...affected_files]),
    affected_tests,
    risk_notes: uniqSorted(risk_notes),
    verify_plan,
    summary_zh,
    heuristic: true,
  };
}

export function formatBlastRadiusBlock(brief: BlastRadiusBrief): string {
  const planned = brief.planned_files.length
    ? brief.planned_files.map((f) => `• ${f}`).join("\n")
    : "• （未提供）";
  const affected = brief.affected_files
    .filter((f) => !brief.planned_files.includes(f))
    .slice(0, 8);
  const affectedLines = affected.length
    ? affected.map((f) => `• ${f}`).join("\n")
    : brief.planned_files.length
      ? "• （未推断额外波及）"
      : "• （未提供）";
  const tests = brief.affected_tests.length
    ? brief.affected_tests.map((f) => `• ${f}`).join("\n")
    : "• （未匹配）";
  const verify = brief.verify_plan
    .map((c, i) => `${i + 1}. ${c}`)
    .join("\n");
  return [
    "（启发式，非完整静态分析）",
    `拟改：\n${planned}`,
    `波及：\n${affectedLines}`,
    `相关测试：\n${tests}`,
    `建议验证：\n${verify}`,
  ].join("\n\n");
}

export function parseBlastRadiusFromTicket(
  ticket: ApprovalTicket,
): BlastRadiusBrief | null {
  const raw = ticket.params?.blast_radius;
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Partial<BlastRadiusBrief>;
  if (!Array.isArray(b.planned_files) && !Array.isArray(b.affected_files)) {
    return null;
  }
  return {
    planned_files: Array.isArray(b.planned_files) ? b.planned_files : [],
    affected_files: Array.isArray(b.affected_files) ? b.affected_files : [],
    affected_tests: Array.isArray(b.affected_tests) ? b.affected_tests : [],
    risk_notes: Array.isArray(b.risk_notes) ? b.risk_notes : [],
    verify_plan: Array.isArray(b.verify_plan) ? b.verify_plan : [],
    summary_zh: typeof b.summary_zh === "string" ? b.summary_zh : "",
    heuristic: true,
  };
}

export function buildExecutionComparison(
  ticket: ApprovalTicket,
  report: ExecutionReportInput,
): ExecutionComparison {
  const brief = parseBlastRadiusFromTicket(ticket);
  // 对照仅比「拟改路径」；affected_files 为启发式波及，不参与计数
  const planned_scope = brief ? uniqSorted(brief.planned_files) : [];
  const actual_files = uniqSorted(
    (report.actual_files ?? []).map(normalizePath),
  );
  const missing_from_actual = findMissingPlanned(planned_scope, actual_files);
  const extra_in_actual = findExtraActual(planned_scope, actual_files);

  const verify_runs = report.verify_runs ?? [];
  const verify_planned = brief?.verify_plan.length ?? 0;
  const verify_ran = verify_runs.length;
  const verify_passed = verify_runs.filter((r) => r.passed === true).length;

  let params_hash_match: boolean | null = null;
  if (report.params_hash) {
    params_hash_match = report.params_hash === ticket.params_hash;
  }

  const affected_hint = brief
    ? brief.affected_files.filter((f) => !brief.planned_files.includes(f))
    : [];

  const lines: string[] = ["【执行对照】"];
  if (planned_scope.length) {
    lines.push(
      `计划拟改 ${planned_scope.length} 处 → 实际改动 ${actual_files.length} 处`,
    );
    if (affected_hint.length) {
      lines.push(
        `（启发式波及 ${affected_hint.length} 处，仅供参考，不计入对照）`,
      );
    }
    if (missing_from_actual.length) {
      lines.push(
        `未改动（计划内）：${missing_from_actual.slice(0, 5).join("、")}${missing_from_actual.length > 5 ? "…" : ""}`,
      );
    }
    if (extra_in_actual.length) {
      lines.push(
        `额外改动：${extra_in_actual.slice(0, 5).join("、")}${extra_in_actual.length > 5 ? "…" : ""}`,
      );
    }
  } else {
    lines.push(`实际改动 ${actual_files.length} 处（批准时无案卷路径）`);
  }

  if (verify_planned > 0 || verify_ran > 0) {
    lines.push(
      `建议测 ${verify_planned} 项 → 跑了 ${verify_ran} 项，通过 ${verify_passed} 项`,
    );
  }

  if (params_hash_match === true) {
    lines.push("参数哈希：与批准工单一致 ✅");
  } else if (params_hash_match === false) {
    lines.push("参数哈希：与批准工单不一致 ⚠️");
  }

  if (report.note?.trim()) {
    lines.push(`备注：${report.note.trim()}`);
  }

  return {
    planned_scope,
    actual_files,
    missing_from_actual,
    extra_in_actual,
    verify_planned,
    verify_ran,
    verify_passed,
    params_hash_match,
    summary_zh: lines.join("\n"),
  };
}

export function formatClosureStatus(ticket: ApprovalTicket): string {
  const brief = parseBlastRadiusFromTicket(ticket);
  const comparison = ticket.params?.execution_comparison;
  const hasComparison =
    comparison &&
    typeof comparison === "object" &&
    typeof (comparison as { summary_zh?: string }).summary_zh === "string";

  if (hasComparison) return "已对照";
  if (ticket.status === "approved") return brief ? "待结案" : "—";
  if (brief) return "有案卷";
  return "—";
}
