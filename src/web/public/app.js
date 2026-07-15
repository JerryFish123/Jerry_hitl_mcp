const listEl = document.getElementById("list");
const emptyEl = document.getElementById("empty");
const listView = document.getElementById("list-view");
const detailView = document.getElementById("detail-view");
const cardEl = document.getElementById("card");
const tabsEl = document.getElementById("tabs");
const backBtn = document.getElementById("back");

let filter = "pending";
let pollTimer = null;
/** @type {{ ticket_id: string, status: string, expires_at: string } | null} */
let detailSnapshot = null;

function ticketIdFromPath() {
  const m = location.pathname.match(/^\/tickets\/([^/]+)\/?$/);
  return m ? decodeURIComponent(m[1]) : null;
}

function fmtTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function remaining(expiresAt) {
  const ms = Date.parse(expiresAt) - Date.now();
  if (Number.isNaN(ms)) return "—";
  if (ms <= 0) return "已过期";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${String(r).padStart(2, "0")}s`;
}

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function renderList(tickets) {
  listEl.innerHTML = "";
  if (!tickets.length) {
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");
  for (const t of tickets) {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="row">
        <strong>${escapeHtml(t.action)}</strong>
        <span class="badge ${t.status}">${t.status}</span>
      </div>
      <div>${escapeHtml(t.summary)}</div>
      <div class="row meta">
        <span>${escapeHtml(t.ticket_id)} · risk ${escapeHtml(t.risk)}</span>
        <span>${t.status === "pending" ? remaining(t.expires_at) : fmtTime(t.decided_at)}</span>
      </div>`;
    div.onclick = () => openDetail(t.ticket_id, true);
    listEl.appendChild(div);
  }
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function updateExpiresLabel(expiresAt) {
  const el = document.getElementById("expires-live");
  if (el) {
    el.textContent = `${fmtTime(expiresAt)} (${remaining(expiresAt)})`;
  }
}

function renderDetail(t) {
  // Keep typed reject reason across re-renders of the same pending ticket
  const prevReason = document.getElementById("reason");
  const savedReason =
    prevReason && detailSnapshot?.ticket_id === t.ticket_id
      ? prevReason.value
      : "";

  const pending = t.status === "pending";
  detailSnapshot = {
    ticket_id: t.ticket_id,
    status: t.status,
    expires_at: t.expires_at,
  };

  cardEl.innerHTML = `
    <div class="row">
      <h2>${escapeHtml(t.action)}</h2>
      <span class="badge ${t.status}">${t.status}</span>
    </div>
    <p>${escapeHtml(t.summary)}</p>
    <div class="kv">
      <span>Ticket</span><span>${escapeHtml(t.ticket_id)}</span>
      <span>Risk</span><span class="badge risk-${escapeHtml(t.risk)}">${escapeHtml(t.risk)}</span>
      <span>Requester</span><span>${escapeHtml(t.requester || "—")}</span>
      <span>Created</span><span>${fmtTime(t.created_at)}</span>
      <span>Expires</span><span id="expires-live">${fmtTime(t.expires_at)} (${remaining(t.expires_at)})</span>
      <span>Hash</span><span><code>${escapeHtml(t.params_hash)}</code></span>
      <span>Decision</span><span>${escapeHtml(t.decision_reason || "—")}</span>
    </div>
    <h3>Params</h3>
    <pre>${escapeHtml(JSON.stringify(t.params, null, 2))}</pre>
    ${
      pending
        ? `<label class="meta" for="reason">拒绝原因（可选）</label>
           <textarea id="reason" placeholder="例如：范围过大，只允许 dry-run"></textarea>
           <div class="actions">
             <button class="action reject" id="btn-reject" type="button">拒绝</button>
             <button class="action approve" id="btn-approve" type="button">批准并继续</button>
           </div>`
        : `<p class="meta">此工单已结束，无法再次审批。</p>`
    }
  `;

  if (pending) {
    const reasonEl = document.getElementById("reason");
    if (reasonEl && savedReason) {
      reasonEl.value = savedReason;
    }
    document.getElementById("btn-approve").onclick = () =>
      resolve(t.ticket_id, "approved");
    document.getElementById("btn-reject").onclick = () =>
      resolve(
        t.ticket_id,
        "rejected",
        document.getElementById("reason").value,
      );
  }
}

async function resolve(ticketId, decision, reason) {
  try {
    const t = await api(`/api/tickets/${encodeURIComponent(ticketId)}/resolve`, {
      method: "POST",
      body: JSON.stringify({ decision, reason }),
    });
    // 按结果跳到对应 Tab 列表（批准→已批准，拒绝→已拒绝）
    goToStatusTab(t.status);
  } catch (err) {
    alert(err.message || String(err));
  }
}

function setActiveTab(nextFilter) {
  filter = nextFilter;
  for (const b of tabsEl.querySelectorAll("button[data-filter]")) {
    b.classList.toggle("active", b.dataset.filter === nextFilter);
  }
}

/** 切到与工单状态对应的列表 Tab */
function goToStatusTab(status) {
  const tab =
    status === "approved" ||
    status === "rejected" ||
    status === "expired" ||
    status === "cancelled" ||
    status === "pending"
      ? status
      : "all";
  setActiveTab(tab);
  showList(true);
}

async function loadList() {
  const data = await api(`/api/tickets?status=${encodeURIComponent(filter)}`);
  renderList(data.tickets || []);
}

async function openDetail(ticketId, pushUrl) {
  const t = await api(`/api/tickets/${encodeURIComponent(ticketId)}`);
  listView.classList.add("hidden");
  detailView.classList.remove("hidden");
  renderDetail(t);
  if (pushUrl) {
    history.pushState({ ticketId }, "", `/tickets/${encodeURIComponent(ticketId)}`);
  }
}

/** Poll detail without wiping the textarea while still pending. */
async function refreshDetailSoft(ticketId) {
  const t = await api(`/api/tickets/${encodeURIComponent(ticketId)}`);
  const samePending =
    detailSnapshot &&
    detailSnapshot.ticket_id === t.ticket_id &&
    detailSnapshot.status === "pending" &&
    t.status === "pending";

  if (samePending) {
    detailSnapshot.expires_at = t.expires_at;
    updateExpiresLabel(t.expires_at);
    return;
  }
  // 状态已变（别处批准/拒绝/过期）：跳到对应 Tab
  if (t.status !== "pending") {
    goToStatusTab(t.status);
    return;
  }
  renderDetail(t);
}

function showList(pushUrl) {
  detailView.classList.add("hidden");
  listView.classList.remove("hidden");
  detailSnapshot = null;
  if (pushUrl) history.pushState({}, "", "/");
  loadList();
}

tabsEl.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-filter]");
  if (!btn) return;
  setActiveTab(btn.dataset.filter);
  showList(true);
});

backBtn.onclick = () => showList(true);

window.addEventListener("popstate", () => {
  const id = ticketIdFromPath();
  if (id) openDetail(id, false);
  else showList(false);
});

async function boot() {
  const id = ticketIdFromPath();
  if (id) {
    await openDetail(id, false);
  } else {
    await loadList();
  }
  pollTimer = setInterval(() => {
    if (!detailView.classList.contains("hidden")) {
      const m = location.pathname.match(/^\/tickets\/([^/]+)/);
      if (m) {
        refreshDetailSoft(decodeURIComponent(m[1])).catch(() => {});
      }
    } else {
      loadList().catch(() => {});
    }
  }, 3000);
}

boot().catch((err) => {
  emptyEl.classList.remove("hidden");
  emptyEl.textContent = `面板加载失败：${err.message}`;
});
