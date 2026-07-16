# hitl_mcp 内置策略（Built-in Skill / Policy）

> 本文件随 MCP 仓库分发，**不是** Cursor 外置 Skill。  
> 运行时由 `assess_and_gate` / `list_dangerous_ops` 执行同等规则。

## 目标

在调用真正有副作用的操作前：

1. 用内置危险操作表评估意图  
2. 若 `medium` / `high` / `critical` → **自动开审批单**  
3. 优先通过 **Cursor MCP elicitation**（IDE 内表单）批准/拒绝；可选网页面板（`HITL_ENABLE_PANEL=1`）  
4. 拒绝/过期必须停止  

## 危险操作枚举（摘要）

| id | 风险 | 典型意图 |
|----|------|----------|
| delete_files | high | 删文件、rm、动 .env |
| git_force_push | critical | force push、reset --hard |
| git_destructive | high | clean -fd、删分支 |
| db_destructive | critical | DROP/TRUNCATE |
| prod_deploy | critical | 生产发布、kubectl apply |
| secrets_exfil | critical | 泄露密钥、提交 .env |
| shell_pipe_curl | critical | curl \| bash |
| chmod_dangerous | high | chmod 777 |
| package_publish | high | npm publish |
| mass_side_effect | high | 群发、批量支付 |

完整匹配规则见源码 `src/policy.ts`。

## Agent 应如何用 MCP

1. 用户提出可能有副作用的请求时，先调 **`assess_and_gate`**（传入 `intent`，可选 `action`/`params`）  
2. 工具调用中 Cursor 弹出审批表单；用户点选后返回 `ticket.status`  
3. 仅 `approved` 可执行（优先 dry-run）；`rejected` / `expired` → 停止  
4. 若仍 `pending`：按 `user_prompt_zh` 提示；可选面板见 `panel_url`  
5. 可用 **`list_dangerous_ops`** 查看内置表  
6. 用户要看 **审批记录 / 审批历史** 时，调用 **`list_approval_history`**，在对话里展示 `summary_zh`（Markdown 表格：时间、操作人、审批人、状态、原因等）

外置 Cursor Skill（`hitl-gate`）负责提醒 Agent **必须走上述流程**。
