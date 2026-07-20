---
name: hitl-gate
description: >-
  ALWAYS use before destructive or irreversible work in this repo: delete/overwrite
  files, .env/secrets, git force-push/reset --hard, DROP/TRUNCATE, prod deploy,
  curl|bash, chmod 777, npm publish, mass email/payment. Call hitl_mcp
  assess_and_gate first; user approves IN IDE via the elicitation form
  (approve/reject). Also use when user asks 看审批记录 / approval history / audit
  log — call list_approval_history and show summary_zh in chat. User does NOT
  need to mention this skill by name.
---

# hitl-gate（外置 Skill → 调用 MCP 内置策略）

## 何时启用

- 用户意图涉及副作用/不可逆操作时  
- 用户说「看审批记录」「审批历史」「audit」等时  

## 危险操作流程

1. **先调用** MCP **`assess_and_gate`**，并传入 **`code_context`**（当前文件、相关 snippets、将影响的路径、代码摘要）
2. 看返回的 **`assessment`**：
   - `risk_level_zh`：无危险 / 低危险 / 中危险 / 高危险 / 致命危险（五档）
   - **`gate_required === true`**（仅高危险、致命危险）→ 必须等用户在 IDE 审批表单批准
   - `gate_required === false` → 无需 HITL，可继续但需谨慎
3. 若需审批：用户点「批准并继续」或「拒绝」
4. 看 `ticket.status` / `approval_channel`：
   - `approved` → 可继续（优先 dry-run）
   - `rejected` → 停止并说明
   - 仍 `pending` → 粘贴 `user_prompt_zh`，不要执行
5. 不确定时仍先 `assess_and_gate` / `list_dangerous_ops`

## 爆炸半径（批前 + 批后）

1. **`assess_and_gate`** 传 `code_context` + 可选 `planned_changes`
2. **高/致命** → 弹窗含 **爆炸半径**（拟改 / 可能波及，启发式）
3. 批准后执行 → **`submit_execution_report`**（`actual_files`、`verify_runs`、`params_hash`）
4. 把返回的 **`summary_zh`** 对照贴给用户

## 查看审批记录

用户要看记录时：

1. 调用 **`list_approval_history`**（可按 status / limit 过滤）
2. **在对话里展示**返回的 `summary_zh`（Markdown **表格**）
3. 不要编造记录；没有数据就如实说暂无

## 禁止

- pending / rejected 时执行删除/推送/部署  
- 跳过 `assess_and_gate`  
- 强制打开浏览器（除非用户明确要求且已启用面板）

## 与 MCP 关系

判断规则在 MCP；本 Skill 约束调用时机与「记录展示在对话里」的体验。  
安装：`npx hitl-gate-mcp init`（默认同时装 Cursor + VS Code 钩子；需先配置 MCP）。
