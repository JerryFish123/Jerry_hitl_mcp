import type { RiskLevel } from "./types.js";

export type RiskLevelOrNone = RiskLevel | "none";

/** 五档风险（与用户面向文案一致） */
export const RISK_TIER_ZH: Record<RiskLevelOrNone, string> = {
  none: "无危险",
  low: "低危险",
  medium: "中危险",
  high: "高危险",
  critical: "致命危险",
};

export const RISK_TIER: Record<RiskLevelOrNone, number> = {
  none: 1,
  low: 2,
  medium: 3,
  high: 4,
  critical: 5,
};

export function riskRank(r: RiskLevelOrNone): number {
  return RISK_TIER[r] ?? 0;
}

export function maxRisk(a: RiskLevelOrNone, b: RiskLevelOrNone): RiskLevelOrNone {
  return riskRank(b) > riskRank(a) ? b : a;
}

/** 仅高危险、致命危险需要走 HITL 审批闸门 */
export function requiresGate(risk: RiskLevelOrNone): boolean {
  return risk === "high" || risk === "critical";
}

export function formatRiskTierZh(risk: RiskLevelOrNone): string {
  return RISK_TIER_ZH[risk] ?? String(risk);
}

export function formatRiskDisplay(risk: RiskLevelOrNone): string {
  if (risk === "none") return RISK_TIER_ZH.none;
  return `${RISK_TIER_ZH[risk]} (${risk})`;
}
