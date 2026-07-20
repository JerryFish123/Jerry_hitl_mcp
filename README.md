# hitl-gate-mcp

给 AI Agent 用的 **Human-in-the-Loop 审批门 MCP**：危险操作先评估、再在 Cursor 里点选批准/拒绝，并可在对话中查看审批记录。

- 运行时：Node.js ≥ 18  
- 传输：stdio MCP  
- 默认审批：Cursor 内建表单（MCP elicitation），无需浏览器  

---

## 方式一：npm / npx（包发布后推荐）

在 Cursor 打开 **Settings → MCP**，编辑 `mcp.json`：

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

保存后确认 `hitl_mcp` 为已连接（绿灯）。

也可全局安装：

```bash
npm install -g hitl-gate-mcp
```

然后把 `command` / `args` 改成直接调用 `hitl-gate-mcp`（或仍用上面的 `npx` 写法）。

---

## 方式二：下载源码，在本地运行

适合尚未发布到 npm，或你要改策略代码时。

### 1. 获取代码并构建

```bash
git clone <本仓库地址>
cd <克隆下来的目录名>
npm install
npm run build
```

构建成功后会生成 `dist/index.js`。

### 2. 配置 Cursor MCP

打开 **Cursor → Settings → MCP**，添加服务器（或编辑 `mcp.json`）。  
**路径必须换成你机器上的绝对路径**：

```json
{
  "mcpServers": {
    "hitl_mcp": {
      "command": "node",
      "args": ["/绝对路径/到/本项目/dist/index.js"],
      "env": {
        "HITL_DATA_DIR": "/绝对路径/到/本项目/data",
        "HITL_ELICIT": "1",
        "HITL_ENABLE_PANEL": "0"
      }
    }
  }
}
```

保存后确认 `hitl_mcp` 显示为已连接 / 绿灯。

> 可用 `pwd`（macOS/Linux）或资源管理器地址栏查看项目绝对路径。  
> `HITL_DATA_DIR` 建议固定为绝对路径，避免 Cursor 工作目录变化导致审批记录读不到。

也可参考：
- [`mcp.json.example`](./mcp.json.example) — npx 用法  
- [`mcp.local.example.json`](./mcp.local.example.json) — 本地 `node` + 绝对路径（请改成你的路径）

---

## 怎么用

### 危险操作审批

1. Agent 在副作用操作前应调用 **`assess_and_gate`**，并传入 **`code_context`**（当前文件、代码片段、将影响的路径等），与 **`intent`** 一并评估  
2. 返回 **五档风险**：无危险 / 低危险 / 中危险 / 高危险 / 致命危险  
3. **仅「高危险」「致命危险」**（`gate_required === true`）会弹出审批表单 → 选择「批准并继续」或「拒绝」  
4. 中/低/无危险不触发 HITL，Agent 可继续但应谨慎  
5. 仅当返回 `ticket.status === "approved"` 时才可继续执行；拒绝/取消则停止  

在对话里随便说「可以」不算正式批准；以工单状态为准。

### 查看审批记录

对 Agent 说：**「看审批记录」**。  
会调用 **`list_approval_history`**，并在对话里以 **Markdown 表格**展示（时间、操作类型、申请人、审批人、状态、原因等）。

### 可用工具

| 工具 | 作用 |
|------|------|
| `assess_and_gate` | 结合 intent + code_context 五档风险评估；仅高/致命危险开单审批 |
| `list_dangerous_ops` | 查看内置危险操作表 |
| `request_approval` | 手动开单（一般用上面主路径即可） |
| `get_approval_status` | 查询某张工单状态 |
| `list_pending` | 列出待审工单 |
| `list_approval_history` | 审批历史（对话展示） |

### 常见危险类型（摘要）

删除文件 / `.env`、Git 强推或硬重置、DROP/TRUNCATE、生产发布、密钥外传、`curl|bash`、`chmod 777`、`npm publish`、群发或批量支付等。  
完整规则见 `builtin/SKILL.md` 与 `src/policy.ts`。

---

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `HITL_ELICIT` | `1` | 是否使用 Cursor 内审批表单 |
| `HITL_ENABLE_PANEL` | `0` | 是否启用本机网页备用面板 |
| `HITL_DATA_DIR` | `./data` | 审批数据目录（建议绝对路径） |
| `HITL_PANEL_PORT` | `8787` | 面板端口（仅开启面板时） |
| `HITL_OPEN_BROWSER` | `0` | 面板启动时是否自动打开浏览器 |

可选备用面板：设置 `HITL_ENABLE_PANEL=1` 后访问 `http://127.0.0.1:8787`。

---

## 本地自检（可选）

```bash
npm run smoke
```

看到 `smoke ok` 表示状态机与存储正常（不依赖 Cursor）。

---

## License

MIT
