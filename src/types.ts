export type RiskLevel = "low" | "medium" | "high" | "critical";

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "cancelled";

export interface ApprovalTicket {
  ticket_id: string;
  action: string;
  summary: string;
  params: Record<string, unknown>;
  params_hash: string;
  risk: RiskLevel;
  status: ApprovalStatus;
  requester?: string;
  created_at: string;
  expires_at: string;
  decided_at?: string;
  decision_reason?: string;
  decided_by?: "web" | "cli" | "cursor";
}

export interface CreateApprovalInput {
  action: string;
  summary: string;
  params?: Record<string, unknown>;
  risk?: RiskLevel;
  ttl_seconds?: number;
  requester?: string;
}
