# 发布清单（GitHub + npm）

本地已完成：`git init`、首个 commit、`origin` 指向  
`https://github.com/JerryFish123/Jerry_hitl_mcp.git`  
包名：`hitl-gate-mcp`（`hitl-mcp` 在 npm 上已被占用）。

## 1. 推送（仓库已建好时可直接执行）

```bash
cd /Users/aaa/Desktop/战役/hitl_mcp
git remote set-url origin https://github.com/JerryFish123/Jerry_hitl_mcp.git
git push -u origin main
```

## 3. 登录 npm 并发布

```bash
npm login
cd /Users/aaa/Desktop/战役/hitl_mcp
npm publish --access public
```

验证：

```bash
npx -y hitl-gate-mcp
```

## 4. Cursor 改用线上包

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
