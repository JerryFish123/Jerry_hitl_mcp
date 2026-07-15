import type { RiskLevel } from "./types.js";

export interface DangerousOpRule {
  id: string;
  action: string;
  title: string;
  risk: RiskLevel;
  /** Match against intent / action / summary (case-insensitive). */
  patterns: RegExp[];
  examples: string[];
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
  },
  {
    id: "chmod_dangerous",
    action: "chmod_dangerous",
    title: "危险权限变更",
    risk: "high",
    patterns: [/chmod\s+777/i, /chmod\s+-R/i, /chown\s+-R/i, /改权限/],
    examples: ["chmod 777 /", "递归改 owner"],
  },
  {
    id: "package_publish",
    action: "package_publish",
    title: "包发布到公共仓库",
    risk: "high",
    patterns: [/npm\s+publish/i, /pypi\s+upload/i, /发布.*npm/i, /发布.*包/],
    examples: ["npm publish"],
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

  // Explicit action name equals a catalog action
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
}> {
  return DANGEROUS_OP_RULES.map((r) => ({
    id: r.id,
    action: r.action,
    title: r.title,
    risk: r.risk,
    examples: r.examples,
  }));
}
