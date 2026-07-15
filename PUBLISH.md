# 发布清单（GitHub + npm）

本地已完成：`git init`、首个 commit、`origin` 指向  
`https://github.com/JerryFish123/hitl-gate-mcp.git`  
包名：`hitl-gate-mcp`（`hitl-mcp` 在 npm 上已被占用）。

## 1. 创建 GitHub 空仓库

浏览器打开：https://github.com/new  

- Repository name: `hitl-gate-mcp`
- Public
- **不要**勾选 README / .gitignore / license（本地已有）

## 2. 推送

```bash
cd /Users/aaa/Desktop/战役/hitl_mcp
git push -u origin main
```

若远程用户名不是 `JerryFish123`，先改 remote：

```bash
git remote set-url origin https://github.com/<你的用户名>/hitl-gate-mcp.git
```

并同步改 `package.json` 里的 `repository` / `homepage` / `bugs`。

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
