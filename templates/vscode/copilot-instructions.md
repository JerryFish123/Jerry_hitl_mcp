# HITL（hitl-gate-mcp）

副作用操作前必须调用 MCP 工具 **`assess_and_gate`**，仅当工单 `approved` 后才能执行。  
高/致命危险会走 IDE 审批表单；若弹窗不可用，展示 `user_prompt_zh`，或使用 `HITL_ENABLE_PANEL=1` 网页面板。  
用户问审批记录时调用 **`list_approval_history`** 并展示 `summary_zh`。  
批准执行后调用 **`submit_execution_report`**。

（若仓库已有自定义 Copilot 说明，请保留本段，或改用 `.github/instructions/hitl-gate.instructions.md`。）
