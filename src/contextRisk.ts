import type { RiskLevelOrNone } from "./riskLabels.js";
import { maxRisk } from "./riskLabels.js";

export interface CodeContextInput {
  /** 工作区根路径 */
  workspace?: string;
  /** 当前焦点文件 */
  active_file?: string;
  /** 本次操作可能影响的文件路径 */
  files?: string[];
  /** 相关代码片段（Agent 从当前代码库摘取） */
  snippets?: Array<{
    path: string;
    content?: string;
    language?: string;
  }>;
  /** Agent 对当前代码/变更范围的简短说明 */
  summary?: string;
}

const SENSITIVE_PATH =
  /\.env|\.pem|id_rsa|credentials?|secrets?|api[_-]?key|token|password|私钥/i;
const PROD_PATH = /[/\\]prod[/\\]|production|\.prod\.|k8s[/\\]prod|terraform[/\\]prod/i;
const DESTRUCTIVE_VERB = /delete|remove|unlink|\brm\b|删|移除|清空|drop|truncate/i;

export function buildAssessmentText(input: {
  intent: string;
  action?: string;
  params?: Record<string, unknown>;
  code_context?: CodeContextInput;
}): { haystack: string; context_summary_zh: string } {
  const parts: string[] = [input.action ?? "", input.intent.trim()];
  if (input.params && Object.keys(input.params).length) {
    parts.push(JSON.stringify(input.params));
  }
  const ctx = input.code_context;
  const contextBits: string[] = [];

  if (ctx?.workspace?.trim()) {
    contextBits.push(`工作区 ${ctx.workspace.trim()}`);
  }
  if (ctx?.active_file?.trim()) {
    contextBits.push(`当前文件 ${ctx.active_file.trim()}`);
    parts.push(ctx.active_file.trim());
  }
  if (ctx?.files?.length) {
    const listed = ctx.files.slice(0, 20).join(", ");
    contextBits.push(`涉及文件 ${listed}${ctx.files.length > 20 ? "…" : ""}`);
    parts.push(...ctx.files);
  }
  if (ctx?.summary?.trim()) {
    contextBits.push(ctx.summary.trim());
    parts.push(ctx.summary.trim());
  }
  for (const snip of ctx?.snippets ?? []) {
    parts.push(snip.path);
    if (snip.content?.trim()) {
      parts.push(snip.content.trim().slice(0, 4000));
    }
  }

  const haystack = parts.filter(Boolean).join("\n").trim();
  const context_summary_zh = contextBits.length
    ? `已结合代码上下文评估：${contextBits.join("；")}`
    : "未提供 code_context，仅基于用户指令与 action 评估；建议 Agent 传入当前文件/片段以提高准确性";

  return { haystack, context_summary_zh };
}

/**
 * 在规则匹配结果之上，根据代码上下文微调风险等级。
 */
export function adjustRiskByContext(
  baseRisk: RiskLevelOrNone,
  input: {
    haystack: string;
    code_context?: CodeContextInput;
  },
): { risk: RiskLevelOrNone; context_factors: string[] } {
  const factors: string[] = [];
  let risk = baseRisk;
  const ctx = input.code_context;
  const paths = [
    ...(ctx?.files ?? []),
    ...(ctx?.snippets?.map((s) => s.path) ?? []),
    ctx?.active_file ?? "",
  ].filter(Boolean);
  const blob = [input.haystack, ...paths].join("\n");

  if (SENSITIVE_PATH.test(blob)) {
    factors.push("上下文或指令涉及敏感文件/凭证");
    risk = maxRisk(risk, "high");
    if (DESTRUCTIVE_VERB.test(input.haystack)) {
      factors.push("对敏感目标执行删除/清空类操作");
      risk = maxRisk(risk, "critical");
    }
  }

  if (PROD_PATH.test(blob) && /deploy|发布|apply|上线|kubectl|helm/i.test(input.haystack)) {
    factors.push("代码上下文含生产相关路径且指令为发布/变更");
    risk = maxRisk(risk, "critical");
  }

  if (
    paths.length >= 10 &&
    /批量|batch|all files|整个项目|全量/i.test(input.haystack)
  ) {
    factors.push("操作范围涉及大量文件");
    risk = maxRisk(risk, "high");
  }

  if (/dry[- ]?run|仅预览|不真正执行|模拟执行/i.test(input.haystack)) {
    factors.push("指令声明为 dry-run/预览（非敏感目标时可降低等级）");
    const sensitive = SENSITIVE_PATH.test(blob);
    if (!sensitive) {
      if (
        risk === "critical" &&
        !/\b(drop|truncate|force)\b/i.test(input.haystack)
      ) {
        risk = "high";
      } else if (risk === "high") {
        risk = "medium";
      }
    }
  }

  return { risk, context_factors: factors };
}
