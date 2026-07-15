import { exec } from "node:child_process";
import { platform } from "node:os";

/**
 * Optionally open URL in default browser.
 * Default OFF — Agent should tell the user the panel URL in chat instead of force-opening.
 * Set HITL_OPEN_BROWSER=1 to enable auto-open.
 */
export function openBrowser(url: string): void {
  const flag = (process.env.HITL_OPEN_BROWSER ?? "0").trim().toLowerCase();
  if (flag !== "1" && flag !== "true" && flag !== "yes") {
    console.error(`[hitl_mcp] panel ready (no auto-open): ${url}`);
    return;
  }

  const p = platform();
  let cmd: string;
  if (p === "darwin") {
    cmd = `open "${url}"`;
  } else if (p === "win32") {
    cmd = `start "" "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }

  exec(cmd, (err) => {
    if (err) {
      console.error(`[hitl_mcp] could not open browser: ${err.message}`);
      console.error(`[hitl_mcp] open manually: ${url}`);
    }
  });
}
