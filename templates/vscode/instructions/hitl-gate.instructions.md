---
applyTo: "**"
---

# HITL 强制闸门（VS Code / GitHub Copilot）

本仓库已启用 MCP **`hitl_mcp`**（npm: `hitl-gate-mcp`）。用户不必说「按 hitl-gate」。

## 强制规则

在执行任何可能不可逆/有副作用的操作之前，必须：

1. 先调用 MCP **`assess_and_gate`**（传入 `code_context` / 可选 `planned_changes`）。
2. 优先使用 **IDE 审批表单**（MCP elicitation）批准或拒绝。
3. 根据工具返回：
   - `ticket.status === "approved"` / `can_execute === true` → 可继续（优先 dry-run）
   - `rejected` / `must_stop` → 停止并说明
   - 仍 `pending` → 把 `user_prompt_zh` 展示给用户，**不要执行**；可建议开启 `HITL_ENABLE_PANEL=1` 用网页面板
4. 不确定是否危险时，仍先 `assess_and_gate`。
5. 用户说「看审批记录 / 审批历史」时：调用 **`list_approval_history`**，在对话里展示 `summary_zh`。

批准并执行后：调用 **`submit_execution_report`**，展示计划 vs 实际对照。

## 禁止

- 跳过 `assess_and_gate` 直接删改/部署。
- 在 pending/rejected 时执行副作用。
- 用聊天口头「可以」代替工单 `approved`。
- 强制打开浏览器（除非用户明确要求且已启用面板）。
