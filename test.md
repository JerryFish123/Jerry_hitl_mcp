# hitl_mcp · 测试流程（按步骤做）

> 目录：`/Users/aaa/Desktop/战役/hitl_mcp`  
> 面板地址：http://127.0.0.1:8787  
> 目的：确认「申请 → 人批/拒 → 查状态」闭环可用  

每完成一步，把 `[ ]` 改成 `[x]`。

---

## 0. 前置（第一次或改过代码后）

在终端执行：

```bash
cd /Users/aaa/Desktop/战役/hitl_mcp
npm install
npm run build
```

- [ ] `npm install` 无报错  
- [ ] `npm run build` 成功（生成/更新 `dist/`）  

**注意**

- Cursor 接 MCP 时，和单独 `npm run panel` **不要同时抢 8787 端口**。  
- 测面板时先用本文件「阶段 B」；接 Cursor 时用「阶段 C」，并先停掉单独的 panel。  

---

## 阶段 A · 离线冒烟（不依赖浏览器 / Cursor）

### A1. 跑自动化状态机测试

```bash
cd /Users/aaa/Desktop/战役/hitl_mcp
npm run smoke
```

- [ ] 终端出现 `smoke ok`  
- [ ] 看到创建了 ticket，并完成批准 + 拒绝两条路径  

若失败：先确认 Node ≥ 18，再重新 `npm run build`。

**本阶段通过标准**：不打开网页也能证明存储与审批状态机正常。

---

## 阶段 B · 审批面板 UI（推荐你现在做）

### B1. 启动面板

若 8787 上已有面板在跑，可跳过启动；否则：

```bash
cd /Users/aaa/Desktop/战役/hitl_mcp
npm run panel
```

期望日志类似：

```text
[hitl_mcp] approval panel: http://127.0.0.1:8787
[hitl_mcp] panel-only mode (no MCP stdio). Ctrl+C to stop.
```

- [ ] 浏览器打开 http://127.0.0.1:8787 能看到标题 `hitl_mcp`  

### B2. 手动造一张 pending 工单

**重要**：面板进程内存不会自动读到「另一个终端刚写入」的单。  
造单后若列表仍空：**停掉 panel（Ctrl+C）→ 再 `npm run panel` → 刷新浏览器**。

另开一个终端执行：

```bash
cd /Users/aaa/Desktop/战役/hitl_mcp
node --input-type=module <<'EOF'
import path from "node:path";
import { ApprovalStore } from "./dist/store.js";
import { createApproval } from "./dist/service.js";

const store = new ApprovalStore({
  dataDir: path.join(process.cwd(), "data"),
  panelBaseUrl: "http://127.0.0.1:8787",
});

const t = createApproval(store, {
  action: "delete_files",
  summary: "测试：删除匹配 **/.env（dry-run，不会真删）",
  params: { globs: ["**/.env"], dry_run: true },
  risk: "high",
  ttl_seconds: 3600,
  requester: "test-md",
});

console.log("ticket_id =", t.ticket_id);
console.log("panel_url =", t.panel_url);
console.log("status    =", t.status);
EOF
```

- [ ] 终端打印了 `ticket_id`（形如 `apr_xxxxxxxx`）和 `status = pending`  
- [ ] （如需要）已重启 `npm run panel`  

### B3. 在面板里看到待审单

- [ ] 打开 http://127.0.0.1:8787 ，点 Tab「待审」  
- [ ] 能看到刚造的 `delete_files` 卡片  
- [ ] 或直接打开终端打印的 `panel_url`  

也可用 API 确认（可选）：

```bash
curl -s "http://127.0.0.1:8787/api/tickets?status=pending"
```

- [ ] JSON 里能看到该 `ticket_id`  

### B4. 测「批准」路径

1. 点进该工单详情  
2. 确认能看到：action / summary / risk / params / params_hash / 倒计时  
3. 点 **批准并继续**  

- [ ] 状态变为 `approved`（绿色）  
- [ ] 「待审」列表里这张单消失（或到「已批准」能看到）  
- [ ] 再次点批准无效 / 提示已结束（不能重复批）  

### B5. 测「拒绝」路径

再造一张单（重复 B2，summary 可改成「测试拒绝」），重启 panel（若列表不更新），然后：

1. 打开详情  
2. 在拒绝原因里填：`测试拒绝：范围过大`  
3. 点 **拒绝**  

- [ ] 状态变为 `rejected`  
- [ ] 详情里能看到拒绝原因  
- [ ] 「已拒绝」Tab 能找到该单  

### B6. 阶段 B 通过标准

- [ ] 批准、拒绝两条路径都亲手点过一遍  
- [ ] 明白：真正放行只发生在面板，不是聊天里说「可以」  

测完可 `Ctrl+C` 停掉 `npm run panel`（若还要测 Cursor，必须停）。

---

## 阶段 C · Cursor MCP 端到端（正式演示）

### C1. 配置 MCP

Cursor → Settings → MCP（或 mcp.json），确保类似：

```json
{
  "mcpServers": {
    "hitl_mcp": {
      "command": "node",
      "args": ["/Users/aaa/Desktop/战役/hitl_mcp/dist/index.js"],
      "env": {
        "HITL_PANEL_PORT": "8787",
        "HITL_DATA_DIR": "/Users/aaa/Desktop/战役/hitl_mcp/data"
      }
    }
  }
}
```

- [ ] 已先 `npm run build`  
- [ ] 已停掉单独的 `npm run panel`  
- [ ] Cursor 里 `hitl_mcp` 显示已连接 / 绿灯  

### C2. 打开面板

MCP 启动后会自己拉起面板：

- [ ] http://127.0.0.1:8787 可打开  

### C3. 对话里走「批准」闭环

对 Agent 说（可复制）：

```text
请使用 hitl_mcp：
1）调用 request_approval：
   action=delete_files
   summary=Cursor测试：删除 **/.env（先申请，不要真删）
   params={"globs":["**/.env"],"dry_run":true}
   risk=high
   requester=cursor-test
2）把 ticket_id 和 panel_url 发给我
3）等我在面板点完后，再调用 get_approval_status
4）若 approved：只打印将执行内容，不要真删；若 rejected/expired：停止并说明原因
```

然后你：

1. 记录 Agent 返回的 `ticket_id`  
2. 面板「待审」点开 → **批准并继续**  
3. 让 Agent 再查状态  

- [ ] Agent 调出了 `request_approval`  
- [ ] 面板出现同一张单（若没有：检查 `HITL_DATA_DIR` 是否绝对路径）  
- [ ] `get_approval_status` 为 `approved`，`can_execute=true`  
- [ ] Agent 没有在 pending 时擅自「执行完毕」  

### C4. 对话里走「拒绝」闭环

重复 C3，但面板点 **拒绝** 并填原因。

- [ ] 状态为 `rejected`，`must_stop=true`  
- [ ] Agent 停止并读出 `decision_reason`  

### C5. （可选）过期路径

让 Agent `request_approval` 时带 `ttl_seconds=30`，等 30 秒后再 `get_approval_status`。

- [ ] 状态变为 `expired`  
- [ ] 面板上无法再批准该单  

### C6. 阶段 C 通过标准

- [ ] Cursor 内批准 + 拒绝都跑通  
- [ ] 可用分屏录一段：左对话、右面板  

---

## 阶段 D · 快速回归清单（以后改代码后用）

```bash
cd /Users/aaa/Desktop/战役/hitl_mcp
npm run build && npm run smoke
```

- [ ] smoke 仍 ok  
- [ ] （可选）再跑 B4/B5 或 C3/C4 中任一条人工路径  

---

## 常见问题

| 现象 | 处理 |
|------|------|
| 造了单但面板是空的 | 重启 `npm run panel` 后再刷新；确认写的是 `./data` |
| 8787 打不开 / EADDRINUSE | `lsof -i :8787` 找到占用进程并结束；只留一个 panel 或一个 MCP |
| Cursor 没有 hitl 工具 | 确认指向 `dist/index.js`，重新 build，开关 MCP |
| Agent 开单面板没有 | MCP 的 `HITL_DATA_DIR` 改成绝对路径后重启 MCP |
| 批了还显示 pending | 再调 `get_approval_status`；刷新浏览器 |

---

## 测试结果记录（可选）

| 日期 | 阶段 | 结果 | 备注 |
|------|------|------|------|
| ____ | A smoke | 通过 / 失败 | |
| ____ | B 面板批/拒 | 通过 / 失败 | ticket: |
| ____ | C Cursor | 通过 / 失败 | ticket: |

---

## 修订记录

| 日期 | 说明 |
|------|------|
| 2026-07-15 | 初版：A 冒烟 / B 面板 / C Cursor / D 回归 |
