# hitl-gate-mcp

Human-in-the-Loop（人在回路）**审批门 MCP**。默认用 **Cursor 内建表单（MCP elicitation）** 点选批准/拒绝；可选本地网页面板。

npm 包名：`hitl-gate-mcp`（原仓库目录名 `hitl_mcp`）。  
作品集编号：**W6**。设计细节见 [`实现思路.md`](./实现思路.md)。  
**逐步测试清单**见 [`test.md`](./test.md)（推荐按 A→B→C 勾选执行）。

> 当前实现语言：**TypeScript / Node.js**（stdio MCP）。  

---

## 快速安装（推荐 · npm / npx）

### Cursor `mcp.json`

```json
{
  "mcpServers": {
    "hitl_mcp": {
      "command": "npx",
      "args": ["-y", "hitl-gate-mcp"],
      "env": {
        "HITL_ELICIT": "1",
        "HITL_ENABLE_PANEL": "0"
      }
    }
  }
}
```

保存后在 Cursor → Settings → MCP 确认绿灯。危险操作会弹 **Cursor 内审批表单**；说「看审批记录」会列出历史。

本地全局安装（可选）：

```bash
npm install -g hitl-gate-mcp
```

---

## 从源码安装 & 构建

在项目根目录执行：

```bash
git clone https://github.com/JerryFish123/Jerry_hitl_mcp.git
cd Jerry_hitl_mcp
npm install
npm run build
```

---

## 它是干什么的

Agent 要做高风险动作时：

1. **优先**调 MCP **`assess_and_gate`**：用**内置危险操作表**评估；危险则**自动开审批单**  
2. **默认**：Cursor 弹出审批表单，你点「批准并继续」或「拒绝」（**无需浏览器**）  
3. 工具返回 `ticket.status`：只有 `approved` 才能继续；`rejected` / `expired` 必须停  
4. **可选**：`HITL_ENABLE_PANEL=1` 时启用本机网页 `http://127.0.0.1:8787` 作为备用通道  

外置 Skill（`.cursor/skills/hitl-gate`）负责提醒 Agent **必须先调 `assess_and_gate`**；判断规则在 MCP 内（`src/policy.ts` + `builtin/SKILL.md`）。

聊天里随便回一句「可以」**不算**；真正放行要看工单变成 `approved`（通常由 Cursor 表单直接写入）。

```text
外置 Skill hitl-gate
        │ 提醒必须评估
        ▼
Cursor Agent --stdio--> hitl_mcp
                          ├─ assess_and_gate → Cursor elicitation（默认）
                          ├─ list_dangerous_ops
                          └─ get_approval_status / list_pending / request_approval
                                 │
                                 ▼
                            data/approvals.json
                                 ▲
可选：浏览器面板（HITL_ENABLE_PANEL=1）
```

### 工具一览

| 工具 | 作用 |
|------|------|
| `assess_and_gate` | **主路径**：风险评估 + 危险则自动开单 |
| `list_dangerous_ops` | 列出内置危险操作枚举 |
| `request_approval` | 手动开单（跳过评估） |
| `get_approval_status` | 查审批结果 |
| `list_pending` | 待审列表 |
| `list_approval_history` | **审批记录/审计**：对话里展示 `summary_zh` |

### 内置危险操作（摘要）

删除文件/`.env` · Git 强推/硬重置 · 破坏性 Git · DROP/TRUNCATE · 生产发布 · 密钥外传 · `curl\|bash` · `chmod 777` · `npm publish` · 群发/批量支付  

完整规则：`hitl_mcp/src/policy.ts`、`hitl_mcp/builtin/SKILL.md`。

---

## 功能

| 入口 | 能力 |
|------|------|
| MCP tools | 上表 5 个工具 |
| Web 面板 | 人批准/拒绝 |
| 内置策略 | `builtin/SKILL.md` + `policy.ts` |
| 外置 Skill | `.cursor/skills/hitl-gate/` |

---

## 本地开发脚本

源码安装见上文「从源码安装 & 构建」。验证存储与状态机（不依赖 Cursor）：

```bash
npm run smoke
```

看到 `smoke ok` 即主体逻辑正常。

常用脚本：

| 命令 | 作用 |
|------|------|
| `npm install` | 安装依赖 |
| `npm run build` | 编译到 `dist/`，并复制面板静态资源 |
| `npm run smoke` | 离线冒烟：创建 → 批准 / 拒绝 |
| `npm run panel` | **只**开审批网页（调试 UI，不接 MCP） |
| `npm start` | 跑完整入口（MCP stdio + 面板；一般由 Cursor 拉起，很少手跑） |

---

## 两种用法（先选一种）

### 用法 A：只看审批面板（最快上手）

适合先熟悉「卡片长什么样、怎么点批准」。

```bash
cd /Users/aaa/Desktop/战役/hitl_mcp
npm run build
npm run panel
```

终端出现类似：

```text
[hitl_mcp] approval panel: http://127.0.0.1:8787
```

浏览器打开：**http://127.0.0.1:8787**

此时还没有 Agent 来开单，列表可能是空的。可用下面「手动造一张单」测 UI，或直接上用法 B。

**手动造一张单（可选）** —— 另开终端：

```bash
cd /Users/aaa/Desktop/战役/hitl_mcp
node --input-type=module -e '
import { ApprovalStore } from "./dist/store.js";
import { createApproval } from "./dist/service.js";
const store = new ApprovalStore({
  dataDir: new URL("./data", import.meta.url).pathname,
  panelBaseUrl: "http://127.0.0.1:8787",
});
const t = createApproval(store, {
  action: "delete_files",
  summary: "删除匹配 **/.env 的文件（演示 dry-run）",
  params: { globs: ["**/.env"], dry_run: true },
  risk: "high",
  requester: "manual-demo",
});
console.log(t.panel_url, t.ticket_id);
'
```

刷新面板 → 「待审」里应出现卡片 → 点进去批准或拒绝。

> 注意：`npm run panel` 与 Cursor 里的 MCP **不要抢同一个端口**（默认都是 8787）。用法 B 开启后，请先停掉单独的 `panel` 进程。

---

### 用法 B：在 Cursor 里当 MCP 用（正式演示）

#### 1. 确保已 build

```bash
cd /Users/aaa/Desktop/战役/hitl_mcp && npm run build
```

#### 2. 配置 Cursor MCP

打开 Cursor → **Settings → MCP**，添加服务器（或编辑 mcp.json）。  
**路径必须是你机器上的绝对路径**：

```json
{
  "mcpServers": {
    "hitl_mcp": {
      "command": "node",
      "args": ["/Users/aaa/Desktop/战役/hitl_mcp/dist/index.js"],
      "env": {
        "HITL_DATA_DIR": "/Users/aaa/Desktop/战役/hitl_mcp/data",
        "HITL_ELICIT": "1",
        "HITL_ENABLE_PANEL": "0"
      }
    }
  }
}
```

保存后确认 `hitl_mcp` 显示为已连接 / 绿灯。

#### 3. 在 Cursor 里审批（默认）

调用 `assess_and_gate` 时，Cursor 应弹出**审批表单**（MCP elicitation）：选择「批准并继续」或「拒绝」。

> 若表单未出现：尽量只开一个窗口；或设 `HITL_ENABLE_PANEL=1` 启用备用网页面板。

#### 4. 在 Agent 对话里走一遍完整流程

可以这样对 Agent 说：

> 请使用 hitl_mcp 的 `assess_and_gate`，intent=`演示：删除 **/.env（仅申请，先不要真删）`。  
> 等我在 Cursor 表单里点完后，根据返回的 `ticket.status` 决定：approved 只打印将要删除的路径；rejected 则停止。

你这边：

1. 看是否弹出审批表单，点「批准」或「拒绝」  
2. 看工具返回的 `ticket.status` / `approval_channel`  
3. （可选）再调 `get_approval_status` 核对  
3. 点 **批准并继续** 或 **拒绝**（拒绝可填原因）  
4. 回到 Cursor，让 Agent 再查状态并继续/停止  

**录屏建议**：左 Cursor、右浏览器分屏，最清楚。

---

## 三个 MCP 工具怎么用

> v0.2 起主路径是 **`assess_and_gate`**（评估+自动开单）。下面仍保留手动 `request_approval` 说明。

### `assess_and_gate` — 评估并自动开单（推荐）

| 参数 | 必填 | 说明 |
|------|------|------|
| `intent` | 是 | 用户原话或拟操作描述 |
| `action` | 否 | 显式动作 id，如 `delete_files` |
| `params` | 否 | 锁定进审批单的参数 |
| `auto_create` | 否 | 危险时是否自动开单，默认 `true` |

返回：`assessment`（是否需要审批、匹配规则）+ 可选 `ticket`（含 `panel_url`）。

### `list_dangerous_ops` — 查看内置危险表

无参数。返回枚举列表。

### `request_approval` — 手动申请审批（跳过评估）

| 参数 | 必填 | 说明 |
|------|------|------|
| `action` | 是 | 动作名，如 `delete_files`、`git_force_push` |
| `summary` | 是 | 给人看的一句话 |
| `params` | 否 | 拟执行参数对象（会被锁定并算 `params_hash`） |
| `risk` | 否 | `low` \| `medium` \| `high` \| `critical` |
| `ttl_seconds` | 否 | 过期秒数，默认 `600` |
| `requester` | 否 | Skill / Agent 名称 |

成功时关键返回字段：

- `ticket_id`：后续查询用  
- `status`：此时应为 `pending`  
- `panel_url`：把这个链接给人打开（或打开根面板再找该单）  
- `params_hash`：参数指纹  
- `can_execute`：此时为 `false`  
- `message`：提醒 Agent 先别执行  

### `get_approval_status` — 查状态

| 参数 | 必填 | 说明 |
|------|------|------|
| `ticket_id` | 是 | `request_approval` 返回的 id |

根据返回判断：

| 字段 / 状态 | Agent 该怎么做 |
|-------------|----------------|
| `status=pending` | 继续等，提示用户去面板 |
| `status=approved` 且 `can_execute=true` | 可以执行（Demo 建议 dry-run） |
| `status=rejected` 或 `must_stop=true` | **停止**，读出 `decision_reason` |
| `status=expired` | **停止**，需重新 `request_approval` |

### `list_pending` — 列出待审单

无参数。返回当前所有 `pending` 工单，便于调试或 Skill 自检。

### `list_approval_history` — 审批记录（对话展示）

用户说「看审批记录」时调用。参数可选：`status`（`all`/`pending`/`approved`/…）、`limit`（默认 20）。

返回 `summary_zh`：Agent **直接贴到对话**即可；另有 `records` / `counts` 便于整理成表。

> **故意没有**给 Agent 的 `approve` 工具：批准/拒绝只在 Cursor elicitation（或可选面板/CLI）上做，防止自批自过。

---

## 网页面板怎么用

地址：http://127.0.0.1:8787  

| 区域 | 说明 |
|------|------|
| 顶部 Tab | 待审 / 全部 / 已批准 / 已拒绝 / 已过期 |
| 列表卡片 | 点进详情；待审会显示剩余时间 |
| 详情 | 动作、摘要、风险、参数 JSON、`params_hash` |
| **批准并继续** | `pending` → `approved` |
| **拒绝** | `pending` → `rejected`（可填原因） |
| 直达链接 | `http://127.0.0.1:8787/tickets/<ticket_id>`（即 `panel_url`） |

面板只绑 **127.0.0.1**，不对外网开放。

---

## 端到端检查清单（演示前过一遍）

- [ ] `npm install` && `npm run build` 成功  
- [ ] `npm run smoke` 输出 `smoke ok`  
- [ ] Cursor 里 `hitl_mcp` 已连接  
- [ ] 浏览器能打开 http://127.0.0.1:8787  
- [ ] Agent 能调出 `request_approval` 并返回 `ticket_id`  
- [ ] 面板能看到该单并完成一次批准  
- [ ] `get_approval_status` 变为 `approved`  
- [ ] 再走一遍拒绝路径（面试更加分）  

---

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `HITL_DATA_DIR` | 进程 cwd 下的 `./data` | 审批单 JSON 存放目录；**Cursor 里建议写成绝对路径** |
| `HITL_ELICIT` | `1` | 是否用 Cursor MCP elicitation（IDE 内表单）审批 |
| `HITL_ENABLE_PANEL` | `0` | 是否启动本地网页面板；发布/分发时建议保持关闭 |
| `HITL_PANEL_PORT` | `8787` | 面板端口（仅面板开启时） |
| `HITL_PANEL_URL` | `http://127.0.0.1:$PORT` | 返回给 Agent 的 `panel_url` 前缀 |
| `HITL_OPEN_BROWSER` | `0` | 面板启动时是否自动打开浏览器 |

数据文件：`$HITL_DATA_DIR/approvals.json`。

---

## 常见问题

**面板打不开 / 端口占用**  
先停掉其它 `npm run panel` 或旧 MCP 进程；或改 `HITL_PANEL_PORT`（配置和面板 URL 一起改）。

**Cursor 里没有工具**  
确认 `args` 指向的是 **`dist/index.js`**（先 `npm run build`），且 MCP 状态为已启用；改配置后重启 MCP / Cursor。

**Agent 开了单但面板是空的**  
多半是 `HITL_DATA_DIR` 不一致（Cursor 工作目录不同）。在 MCP `env` 里写成绝对路径，例如本仓库的 `/Users/aaa/Desktop/战役/hitl_mcp/data`。

**点批准后 Agent 还说 pending**  
让它再调一次 `get_approval_status`；面板每约 3 秒自动刷新，也可手动刷新浏览器。

**会不会真的删文件？**  
本仓库 MCP **只做审批状态**，不执行删除。真正危险动作要你自己在批准后再接执行器；Demo 请始终 `dry_run: true`。

---

## 目录结构（用的时候看这些就够）

```text
hitl_mcp/
  README.md           ← 本说明
  实现思路.md         ← 设计与面试口径
  package.json
  src/                ← 源码
  dist/               ← build 产物（Cursor 指向这里）
  data/               ← 运行后生成的审批数据（本地，勿提交机密）
```

---

## 和作品集其它件的关系

- **W6**：本项目（能力闸门）  
- **W5 Skills**：流程 SOP，步骤里应强制调用本 MCP 的 `request_approval`  
- 面试一句话：Skills 管「怎么做」，hitl_mcp 管「敏感步骤谁说了算」。
