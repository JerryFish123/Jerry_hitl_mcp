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

本机 `npm login --auth-type=web` 在部分环境下会异常退出，请你**自己在终端**执行：

```bash
npm login
cd /Users/aaa/Desktop/战役/hitl_mcp
npm publish --access public
```

或用 GitHub Actions：在仓库 Settings → Secrets 添加 `NPM_TOKEN`（npm 网站 Access Token），再 Actions → **publish-npm** → Run workflow。

验证：

```bash
npx -y hitl-gate-mcp
```

## 4. Cursor 改用线上包

参考仓库内 [`mcp.json.example`](./mcp.json.example)：

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
