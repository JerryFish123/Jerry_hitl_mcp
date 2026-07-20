import type { RiskLevel } from "./types.js";
import {
  adjustRiskByContext,
  buildAssessmentText,
  type CodeContextInput,
} from "./contextRisk.js";
import {
  formatRiskTierZh,
  maxRisk,
  requiresGate,
  riskRank,
  type RiskLevelOrNone,
} from "./riskLabels.js";

export type { CodeContextInput };

export interface DangerousOpRule {
  id: string;
  action: string;
  title: string;
  risk: RiskLevel;
  /** Match against intent / action / summary (case-insensitive). */
  patterns: RegExp[];
  examples: string[];
  /** What may happen if not gated. */
  impact_zh: string;
  /** What user consent means when approving. */
  if_approved_zh: string;
}

/**
 * Built-in dangerous operation catalog (policy inside MCP).
 * Keep patterns conservative: better over-gate than miss.
 */
export const DANGEROUS_OP_RULES: DangerousOpRule[] = [
  {
    id: "delete_files",
    action: "delete_files",
    title: "删除文件/目录",
    risk: "high",
    patterns: [
      /\bdelete\b.*\bfile/i,
      /\brm\b/i,
      /unlink/i,
      /删除.*文件/,
      /删掉/,
      /移除.*文件/,
      /\.env\b/i,
      /node_modules/i,
    ],
    examples: ["删除 .env", "rm -rf dist", "清掉密钥文件"],
    impact_zh:
      "文件或目录被永久删除后通常无法通过 Git 恢复；若涉及 .env、密钥或 node_modules，可能导致服务无法启动或需重新配置。",
    if_approved_zh:
      "Agent 将执行删除操作（如 rm、Delete 工具等）。请确认路径与范围正确；建议先备份或使用 dry-run。",
  },
  {
    id: "git_force_push",
    action: "git_force_push",
    title: "Git 强制推送 / 硬重置",
    risk: "critical",
    patterns: [
      /force\s*push/i,
      /push\s+--force/i,
      /git\s+push\s+-f/i,
      /reset\s+--hard/i,
      /强制推送/,
      /强推/,
      /硬重置/,
    ],
    examples: ["force push main", "git reset --hard"],
    impact_zh:
      "可能覆盖远程历史、丢失他人提交或未推送的本地改动；硬重置会丢弃工作区与暂存区变更。",
    if_approved_zh:
      "Agent 将执行 force push 或 reset --hard 等操作。请确认分支与协作者已知情。",
  },
  {
    id: "git_destructive",
    action: "git_destructive",
    title: "破坏性 Git 操作",
    risk: "high",
    patterns: [
      /git\s+clean\s+-fd/i,
      /drop\s+branch/i,
      /删除.*分支/,
      /rebase.*main/i,
    ],
    examples: ["git clean -fdx", "删掉远程分支"],
    impact_zh:
      "可能删除未跟踪文件、清理本地构建产物，或改写共享分支历史，影响团队协作。",
    if_approved_zh:
      "Agent 将执行 git clean、删分支、rebase 等破坏性 Git 命令。",
  },
  {
    id: "db_destructive",
    action: "db_destructive",
    title: "数据库破坏性操作",
    risk: "critical",
    patterns: [
      /\bdrop\s+(table|database|schema)\b/i,
      /\btruncate\b/i,
      /删除.*表/,
      /清空.*数据库/,
      /migrate\s+down/i,
    ],
    examples: ["DROP TABLE users", "truncate orders"],
    impact_zh:
      "DROP/TRUNCATE 或回滚 migration 可能导致数据永久丢失或生产服务中断。",
    if_approved_zh:
      "Agent 将对数据库执行破坏性 SQL 或 migration。请确认环境（非生产）且有备份。",
  },
  {
    id: "prod_deploy",
    action: "prod_deploy",
    title: "生产环境发布/变更",
    risk: "critical",
    patterns: [
      /deploy.*prod/i,
      /生产.*发布/,
      /发布.*生产/,
      /kubectl\s+apply/i,
      /helm\s+upgrade/i,
    ],
    examples: ["部署到生产", "kubectl apply -f prod"],
    impact_zh:
      "生产变更可能影响线上用户；错误发布可能导致宕机、回滚困难或数据不一致。",
    if_approved_zh:
      "Agent 将向生产环境部署或变更配置。请确认变更窗口、监控与回滚方案。",
  },
  {
    id: "secrets_exfil",
    action: "secrets_exfil",
    title: "密钥/凭证外传或打印",
    risk: "critical",
    patterns: [
      /api[_-]?key/i,
      /secret/i,
      /password/i,
      /私钥/,
      /打印.*密钥/,
      /上传.*\.env/i,
      /commit.*\.env/i,
    ],
    examples: ["把 API key 发到聊天", "提交 .env"],
    impact_zh:
      "密钥、Token 或 .env 内容可能进入聊天记录、日志或 Git 历史，造成泄露与账号被盗用。",
    if_approved_zh:
      "Agent 可能读取、打印、提交或外传敏感凭证。请确认不会进入公开仓库或对话记录。",
  },
  {
    id: "shell_pipe_curl",
    action: "shell_pipe_curl",
    title: "远程脚本管道执行",
    risk: "critical",
    patterns: [
      /curl\s+.*\|\s*(ba)?sh/i,
      /wget\s+.*\|\s*(ba)?sh/i,
      /管道.*执行/,
    ],
    examples: ["curl xxx | bash"],
    impact_zh:
      "远程脚本可在本机任意执行命令，等同于运行不可信代码，风险极高。",
    if_approved_zh:
      "Agent 将下载并管道执行远程脚本。请确认来源可信且内容已审阅。",
  },
  {
    id: "chmod_dangerous",
    action: "chmod_dangerous",
    title: "危险权限变更",
    risk: "high",
    patterns: [/chmod\s+777/i, /chmod\s+-R/i, /chown\s+-R/i, /改权限/],
    examples: ["chmod 777 /", "递归改 owner"],
    impact_zh:
      "过度开放权限可能导致任意用户读写系统文件，扩大攻击面或破坏安全策略。",
    if_approved_zh:
      "Agent 将修改文件或目录权限（如 chmod 777）。请确认路径与权限最小化原则。",
  },
  {
    id: "package_publish",
    action: "package_publish",
    title: "包发布到公共仓库",
    risk: "high",
    patterns: [/npm\s+publish/i, /pypi\s+upload/i, /发布.*npm/i, /发布.*包/],
    examples: ["npm publish"],
    impact_zh:
      "公开发布后版本难以撤回；错误版本可能被他人安装，影响供应链安全。",
    if_approved_zh:
      "Agent 将向 npm/PyPI 等公共仓库发布包。请确认版本号、内容与访问令牌。",
  },
  {
    id: "mass_side_effect",
    action: "mass_side_effect",
    title: "大规模外部副作用",
    risk: "high",
    patterns: [
      /群发/,
      /mass\s+email/i,
      /send\s+to\s+all/i,
      /批量.*支付/,
      /转账/,
      /payment/i,
    ],
    examples: ["群发邮件给所有用户", "批量转账"],
    impact_zh:
      "群发通知、邮件或批量支付可能打扰大量用户，或产生真实资金/合规风险。",
    if_approved_zh:
      "Agent 将触发面向多用户的外部副作用（邮件、支付等）。请确认名单与金额。",
  },
  // --- 中/低危险：评估并告知 Agent，但不触发 HITL 审批 ---
  {
    id: "git_push_regular",
    action: "git_push",
    title: "Git 推送（非 force）",
    risk: "medium",
    patterns: [
      /\bgit\s+push\b/i,
      /推送.*远程/,
      /push\s+origin/i,
    ],
    examples: ["git push origin feature", "推送到远程"],
    impact_zh: "可能将本地提交推送到远程，影响团队共享分支。",
    if_approved_zh: "Agent 将执行 git push（非 force）。请确认分支与提交内容。",
  },
  {
    id: "file_modify",
    action: "file_modify",
    title: "修改/写入文件",
    risk: "medium",
    patterns: [
      /修改.*文件/,
      /写入.*文件/,
      /覆盖.*文件/,
      /更新.*代码/,
      /refactor/i,
      /重构/,
    ],
    examples: ["修改 src/index.ts", "重构组件"],
    impact_zh: "会改变项目源码或配置，可能引入 bug 或破坏构建。",
    if_approved_zh: "Agent 将编辑或写入文件。请确认 diff 范围。",
  },
  {
    id: "package_install",
    action: "package_install",
    title: "安装依赖",
    risk: "medium",
    patterns: [
      /\bnpm\s+install\b/i,
      /\bnpm\s+i\b/i,
      /\bpnpm\s+add\b/i,
      /\byarn\s+add\b/i,
      /pip\s+install/i,
      /安装.*依赖/,
    ],
    examples: ["npm install lodash", "pnpm add vue"],
    impact_zh: "可能改变 lockfile 与 node_modules，引入供应链或版本冲突风险。",
    if_approved_zh: "Agent 将安装或更新依赖包。",
  },
  {
    id: "read_explore",
    action: "read_explore",
    title: "只读探索",
    risk: "low",
    patterns: [
      /解释.*代码/,
      /帮我看/,
      /阅读.*文件/,
      /\bgrep\b/i,
      /\bsearch\b/i,
      /搜索.*代码/,
      /列出.*文件/,
      /什么是/,
      /怎么.*工作/,
    ],
    examples: ["解释这段代码", "搜索函数定义"],
    impact_zh: "通常为只读操作，直接副作用较小。",
    if_approved_zh: "Agent 将读取或分析代码，不预期产生写入副作用。",
  },
  {
    id: "format_lint",
    action: "format_lint",
    title: "格式化 / Lint",
    risk: "low",
    patterns: [
      /format/i,
      /prettier/i,
      /eslint\s+--fix/i,
      /格式化/,
      /lint\s+fix/i,
    ],
    examples: ["run prettier", "eslint --fix"],
    impact_zh: "主要改变代码风格，逻辑风险相对较低。",
    if_approved_zh: "Agent 将运行格式化或 lint fix。",
  },
];

export interface RiskAssessment {
  /** @deprecated 使用 gate_required；保留兼容 */
  requires_approval: boolean;
  gate_required: boolean;
  risk: RiskLevelOrNone;
  risk_tier: number;
  risk_level_zh: string;
  matched_rules: Array<{
    id: string;
    action: string;
    title: string;
    risk: RiskLevel;
  }>;
  suggested_action: string;
  rationale: string;
  context_summary_zh: string;
  context_factors: string[];
}

export { requiresGate, formatRiskTierZh, type RiskLevelOrNone };

/**
 * Assess user intent + optional code context per built-in catalog.
 * Only 高危险 / 致命危险 (high / critical) trigger gate_required.
 */
export function assessRisk(input: {
  intent: string;
  action?: string;
  params?: Record<string, unknown>;
  code_context?: CodeContextInput;
}): RiskAssessment {
  const { haystack, context_summary_zh } = buildAssessmentText(input);
  const matched: RiskAssessment["matched_rules"] = [];
  let top: RiskLevelOrNone = "none";

  for (const rule of DANGEROUS_OP_RULES) {
    const hit = rule.patterns.some((p) => p.test(haystack));
    if (!hit) continue;
    matched.push({
      id: rule.id,
      action: rule.action,
      title: rule.title,
      risk: rule.risk,
    });
    top = maxRisk(top, rule.risk);
  }

  if (input.action) {
    const byName = DANGEROUS_OP_RULES.find(
      (r) => r.action === input.action || r.id === input.action,
    );
    if (byName && !matched.some((m) => m.id === byName.id)) {
      matched.push({
        id: byName.id,
        action: byName.action,
        title: byName.title,
        risk: byName.risk,
      });
      top = maxRisk(top, byName.risk);
    }
  }

  const { risk: adjusted, context_factors } = adjustRiskByContext(top, {
    haystack,
    code_context: input.code_context,
  });
  top = adjusted;

  const gate_required = requiresGate(top);
  const suggested =
    matched.sort((a, b) => riskRank(b.risk) - riskRank(a.risk))[0]?.action ??
    (input.action?.trim() || "unspecified_action");

  const rationale =
    top === "none"
      ? "未命中内置规则；结合上下文评估为无危险，无需 HITL 审批。"
      : gate_required
        ? `评估为${formatRiskTierZh(top)}，命中 ${matched.length} 条规则，需 HITL 审批。`
        : `评估为${formatRiskTierZh(top)}，Agent 可自行继续但应谨慎；无需 HITL 审批。`;

  return {
    requires_approval: gate_required,
    gate_required,
    risk: top,
    risk_tier: riskRank(top),
    risk_level_zh: formatRiskTierZh(top),
    matched_rules: matched,
    suggested_action: suggested,
    rationale,
    context_summary_zh,
    context_factors,
  };
}

export function listDangerousOpsPublic(): Array<{
  id: string;
  action: string;
  title: string;
  risk: RiskLevel;
  examples: string[];
  impact_zh: string;
  if_approved_zh: string;
}> {
  return DANGEROUS_OP_RULES.map((r) => ({
    id: r.id,
    action: r.action,
    title: r.title,
    risk: r.risk,
    examples: r.examples,
    impact_zh: r.impact_zh,
    if_approved_zh: r.if_approved_zh,
  }));
}

export function getRuleById(id: string): DangerousOpRule | undefined {
  return DANGEROUS_OP_RULES.find((r) => r.id === id);
}
