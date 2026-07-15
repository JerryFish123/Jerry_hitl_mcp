import fs from "node:fs";
import path from "node:path";
import { hashParams, newTicketId } from "./hash.js";
import type {
  ApprovalStatus,
  ApprovalTicket,
  CreateApprovalInput,
  RiskLevel,
} from "./types.js";

export interface StoreConfig {
  dataDir: string;
  panelBaseUrl: string;
}

function defaultDataDir(): string {
  return process.env.HITL_DATA_DIR?.trim() || path.join(process.cwd(), "data");
}

function defaultPanelBaseUrl(): string {
  const port = process.env.HITL_PANEL_PORT?.trim() || "8787";
  return process.env.HITL_PANEL_URL?.trim() || `http://127.0.0.1:${port}`;
}

export function createStoreConfig(): StoreConfig {
  return {
    dataDir: defaultDataDir(),
    panelBaseUrl: defaultPanelBaseUrl(),
  };
}

export class ApprovalStore {
  private readonly filePath: string;
  private readonly panelBaseUrl: string;
  private tickets: Map<string, ApprovalTicket> = new Map();

  constructor(config: StoreConfig = createStoreConfig()) {
    this.panelBaseUrl = config.panelBaseUrl.replace(/\/$/, "");
    fs.mkdirSync(config.dataDir, { recursive: true });
    this.filePath = path.join(config.dataDir, "approvals.json");
    this.load();
  }

  getPanelUrl(ticketId: string): string {
    return `${this.panelBaseUrl}/tickets/${ticketId}`;
  }

  private load(): void {
    if (!fs.existsSync(this.filePath)) {
      this.persist();
      return;
    }
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as { tickets?: ApprovalTicket[] };
      this.tickets = new Map();
      for (const t of parsed.tickets ?? []) {
        this.tickets.set(t.ticket_id, t);
      }
    } catch {
      this.tickets = new Map();
      this.persist();
    }
  }

  /** Re-read JSON so MCP + standalone panel stay in sync across processes. */
  private syncFromDisk(): void {
    this.load();
  }

  private persist(): void {
    const payload = {
      updated_at: new Date().toISOString(),
      tickets: [...this.tickets.values()].sort((a, b) =>
        b.created_at.localeCompare(a.created_at),
      ),
    };
    fs.writeFileSync(this.filePath, JSON.stringify(payload, null, 2), "utf8");
  }

  /** Lazy-expire pending tickets past expires_at. */
  refresh(ticket: ApprovalTicket): ApprovalTicket {
    if (
      ticket.status === "pending" &&
      Date.now() > Date.parse(ticket.expires_at)
    ) {
      const expired: ApprovalTicket = {
        ...ticket,
        status: "expired",
        decided_at: new Date().toISOString(),
        decision_reason: "ttl_expired",
        decided_by: ticket.decided_by,
      };
      this.tickets.set(expired.ticket_id, expired);
      this.persist();
      return expired;
    }
    return ticket;
  }

  create(input: CreateApprovalInput): ApprovalTicket {
    this.syncFromDisk();
    const params = input.params ?? {};
    const risk: RiskLevel = input.risk ?? "high";
    const ttl = Math.max(30, Math.min(input.ttl_seconds ?? 600, 86400));
    const now = Date.now();
    const ticket: ApprovalTicket = {
      ticket_id: newTicketId(),
      action: input.action.trim(),
      summary: input.summary.trim(),
      params,
      params_hash: hashParams(params),
      risk,
      status: "pending",
      requester: input.requester?.trim() || undefined,
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + ttl * 1000).toISOString(),
    };
    this.tickets.set(ticket.ticket_id, ticket);
    this.persist();
    return ticket;
  }

  get(ticketId: string): ApprovalTicket | undefined {
    this.syncFromDisk();
    const t = this.tickets.get(ticketId);
    return t ? this.refresh(t) : undefined;
  }

  list(filter?: { status?: ApprovalStatus | "all" }): ApprovalTicket[] {
    this.syncFromDisk();
    const all = [...this.tickets.values()].map((t) => this.refresh(t));
    const status = filter?.status ?? "all";
    const filtered =
      status === "all" ? all : all.filter((t) => t.status === status);
    return filtered.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  listPending(): ApprovalTicket[] {
    return this.list({ status: "pending" });
  }

  resolve(
    ticketId: string,
    decision: "approved" | "rejected",
    opts?: { reason?: string; decided_by?: "web" | "cli" | "cursor" },
  ): ApprovalTicket {
    this.syncFromDisk();
    const current = this.get(ticketId);
    if (!current) {
      throw new Error(`ticket_not_found: ${ticketId}`);
    }
    if (current.status === "expired") {
      throw new Error(`ticket_expired: ${ticketId}`);
    }
    if (current.status !== "pending") {
      throw new Error(
        `ticket_not_pending: ${ticketId} current=${current.status}`,
      );
    }
    const next: ApprovalTicket = {
      ...current,
      status: decision,
      decided_at: new Date().toISOString(),
      decision_reason:
        decision === "rejected"
          ? opts?.reason?.trim() || "rejected_by_human"
          : opts?.reason?.trim() || "approved_by_human",
      decided_by: opts?.decided_by ?? "web",
    };
    this.tickets.set(ticketId, next);
    this.persist();
    return next;
  }
}

/** Singleton for MCP + web sharing the same process. */
let sharedStore: ApprovalStore | undefined;

export function getSharedStore(): ApprovalStore {
  if (!sharedStore) {
    sharedStore = new ApprovalStore();
  }
  return sharedStore;
}
