import type { RiskLevel } from "./types.js";

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
];

export interface RiskAssessment {
  requires_approval: boolean;
  risk: RiskLevel | "none";
  matched_rules: Array<{
    id: string;
    action: string;
    title: string;
    risk: RiskLevel;
  }>;
  suggested_action: string;
  rationale: string;
}

function riskRank(r: RiskLevel | "none"): number {
  switch (r) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}

function maxRisk(a: RiskLevel | "none", b: RiskLevel): RiskLevel | "none" {
  return riskRank(b) > riskRank(a) ? b : a;
}

/**
 * Assess whether text / action looks dangerous per built-in catalog.
 */
export function assessRisk(input: {
  intent: string;
  action?: string;
}): RiskAssessment {
  const hay = `${input.action ?? ""}\n${input.intent}`.trim();
  const matched: RiskAssessment["matched_rules"] = [];
  let top: RiskLevel | "none" = "none";

  for (const rule of DANGEROUS_OP_RULES) {
    const hit = rule.patterns.some((p) => p.test(hay));
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

  const requires = top === "high" || top === "critical" || top === "medium";
  const suggested =
    matched[0]?.action ??
    (input.action?.trim() || "unspecified_sensitive_action");

  return {
    requires_approval: requires,
    risk: top,
    matched_rules: matched,
    suggested_action: suggested,
    rationale: requires
      ? `Matched ${matched.length} built-in rule(s): ${matched.map((m) => m.id).join(", ")}`
      : "No built-in dangerous-operation rule matched. Proceed without HITL gate (still use judgment).",
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
