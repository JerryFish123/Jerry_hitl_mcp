# hitl_mcp 内置策略（Built-in Skill / Policy）

> 本文件随 MCP 仓库分发，**不是** Cursor 外置 Skill。  
> 运行时由 `assess_and_gate` / `list_dangerous_ops` 执行同等规则。

## 目标

在调用真正有副作用的操作前：

1. 用内置危险操作表 + `code_context` 评估意图（五档风险）  
2. 若 **高危险 / 致命危险** → **自动开审批单**（含爆炸半径案卷）  
3. 优先通过 **IDE MCP elicitation** 批准/拒绝；可选网页面板（`HITL_ENABLE_PANEL=1`）  
4. 批准后执行 → 调用 **`submit_execution_report`** 产出计划 vs 实际对照  
5. 拒绝/过期必须停止  

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

1. 副作用操作前调 **`assess_and_gate`**（`intent` + **`code_context`** + 可选 **`planned_changes`**）  
2. 看 `gate_required`：仅 **高/致命** 弹审批；案卷在 `blast_radius` / 弹窗【爆炸半径案卷】  
3. 仅 `ticket.status === "approved"` 可执行  
4. 执行后调 **`submit_execution_report`**（`actual_files`、`verify_runs`、`params_hash`）  
5. 用户要看记录 → **`list_approval_history`**，展示 `summary_zh` 表格（含案卷/对照列）  
6. 可用 **`list_dangerous_ops`** 查看内置表  

外置 Cursor Skill（`hitl-gate`）负责提醒 Agent **必须走上述流程**。
