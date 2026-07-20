# hitl-gate-mcp

给 AI Agent 用的 **Human-in-the-Loop 审批门 MCP**：危险操作先评估、再在 IDE 里点选批准/拒绝，并可在对话中查看审批记录。

- 运行时：Node.js ≥ 18  
- 传输：stdio MCP  
- 默认审批：IDE 内建表单（MCP elicitation）；不可用时走聊天文案 / 可选网页面板  
- 客户端：**Cursor** 与 **VS Code（GitHub Copilot）** 同一套接入步骤  

---

## 推荐接入（两步，双端相同）

### ① 配置 MCP（让工具连上）

两边都用同一进程：`npx -y hitl-gate-mcp`。差异只在配置文件路径/字段名。

**Cursor** — `.cursor/mcp.json`（或 Cursor Settings → MCP）：

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

**VS Code** — `.vscode/mcp.json`（或用户 MCP 设置；字段多为 `servers`）：

```json
{
  "servers": {
    "hitl_mcp": {
      "type": "stdio",
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

也可参考包内示例（`init` 会拷到项目里）：

- Cursor：`.cursor/mcp.json.example`
- VS Code：`.vscode/mcp.json.example`

保存后确认 `hitl_mcp` 已连接。  
连接后 Client 会收到 Server **`instructions`**（软提醒：副作用前先 `assess_and_gate`）。

### ② 手动 init（装上硬约束，提高遵从率）

在**目标项目根目录**：

```bash
hitl-gate-mcp init
# 或
npx hitl-gate-mcp init
```

默认 **`--client all`**，一次写入 Cursor + VS Code 钩子：

| 客户端 | 写入内容 |
|--------|----------|
| Cursor | `.cursor/rules/hitl-auto-gate.mdc`、`.cursor/skills/hitl-gate/SKILL.md` |
| VS Code / Copilot | `.github/instructions/hitl-gate.instructions.md` |

只要其中一个客户端：

```bash
hitl-gate-mcp init --client cursor
hitl-gate-mcp init --client vscode
```

已存在则跳过；覆盖加 `--force`。预览 `--dry-run`。

```bash
npm install -g hitl-gate-mcp   # 一次
hitl-gate-mcp init             # 任意项目
```

> **诚实边界**：只配 MCP、不跑 `init` → 依赖模型遵从 `instructions`，**不保证**每次都调闸门。  
> MCP **不能**拦截 IDE 原生 Delete/Terminal。

---

## 审批弹窗不可用时（VS Code 更常见）

1. Agent 应把返回的 **`user_prompt_zh`** 贴到对话里，**停止执行**  
2. 可选：MCP env 设 `HITL_ENABLE_PANEL=1`，浏览器打开 `http://127.0.0.1:8787` 批/拒  
3. 再调 `get_approval_status`，仅 `approved` 后继续  

---

## 方式二：源码本地运行

```bash
git clone <本仓库地址>
cd <克隆下来的目录名>
npm install
npm run build
```

把 MCP 的 `command`/`args` 改成：

```text
node /绝对路径/到/本项目/dist/index.js
```

`HITL_DATA_DIR` 建议用绝对路径。示例见 [`mcp.local.example.json`](./mcp.local.example.json)。

---

## 怎么用

### 危险操作审批

1. Agent 在副作用前调用 **`assess_and_gate`**（带 `code_context`）  
2. 五档风险；仅 **高/致命** 开审批  
3. 表单批准 / 拒绝；聊天「可以」不算批准  
4. 高/致命附带 **爆炸半径**；执行后 **`submit_execution_report`**  

### 查看审批记录

说：**「看审批记录」** → `list_approval_history` → 展示 `summary_zh` 表格。

### 可用工具

| 工具 | 作用 |
|------|------|
| `assess_and_gate` | 五档风险 + 爆炸半径；仅高/致命开单 |
| `submit_execution_report` | 批后计划 vs 实际对照 |
| `list_dangerous_ops` | 内置危险操作表 |
| `request_approval` | 手动开单 |
| `get_approval_status` | 查工单 |
| `list_pending` | 待审列表 |
| `list_approval_history` | 审批历史 |

---

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `HITL_ELICIT` | `1` | 是否使用 IDE 内审批表单 |
| `HITL_ENABLE_PANEL` | `0` | 本机网页备用面板 |
| `HITL_DATA_DIR` | `./data` | 审批数据目录（建议绝对路径） |
| `HITL_PANEL_PORT` | `8787` | 面板端口 |
| `HITL_OPEN_BROWSER` | `0` | 面板是否自动开浏览器 |

---

## 本地自检

```bash
npm run smoke
```

---

## License

MIT
