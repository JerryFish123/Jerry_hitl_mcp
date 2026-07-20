import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type InitClient = "cursor" | "vscode" | "all";

export interface InitOptions {
  cwd?: string;
  force?: boolean;
  dryRun?: boolean;
  /** Default: all — install hooks for both Cursor and VS Code / Copilot */
  client?: InitClient;
}

function packageRoot(): string {
  // dist/cli/init.js → ../../
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

function templatesDir(): string {
  return path.join(packageRoot(), "templates");
}

interface CopyPlan {
  from: string;
  to: string;
  label: string;
  /** If true, never overwrite an existing destination unless --force */
  optionalExample?: boolean;
}

function buildPlan(cwd: string, client: InitClient): CopyPlan[] {
  const t = templatesDir();
  const plans: CopyPlan[] = [];

  if (client === "cursor" || client === "all") {
    plans.push(
      {
        from: path.join(t, "cursor", "rules", "hitl-auto-gate.mdc"),
        to: path.join(cwd, ".cursor", "rules", "hitl-auto-gate.mdc"),
        label: "Cursor Rule",
      },
      {
        from: path.join(t, "cursor", "skills", "hitl-gate", "SKILL.md"),
        to: path.join(cwd, ".cursor", "skills", "hitl-gate", "SKILL.md"),
        label: "Cursor Skill",
      },
      {
        from: path.join(t, "shared", "mcp.cursor.json.example"),
        to: path.join(cwd, ".cursor", "mcp.json.example"),
        label: "Cursor mcp.json.example",
        optionalExample: true,
      },
    );
  }

  if (client === "vscode" || client === "all") {
    plans.push(
      {
        from: path.join(
          t,
          "vscode",
          "instructions",
          "hitl-gate.instructions.md",
        ),
        to: path.join(
          cwd,
          ".github",
          "instructions",
          "hitl-gate.instructions.md",
        ),
        label: "VS Code / Copilot instructions",
      },
      {
        from: path.join(t, "vscode", "copilot-instructions.md"),
        to: path.join(cwd, ".github", "copilot-instructions.hitl.md"),
        label: "Copilot instructions snippet",
        optionalExample: true,
      },
      {
        from: path.join(t, "vscode", "mcp.json.example"),
        to: path.join(cwd, ".vscode", "mcp.json.example"),
        label: "VS Code mcp.json.example",
        optionalExample: true,
      },
    );
  }

  return plans;
}

/**
 * Install client hooks (Cursor Rule/Skill and/or VS Code Copilot instructions).
 * Does not overwrite live mcp.json — only writes *.example unless you merge manually.
 */
export function runInit(options: InitOptions = {}): {
  ok: boolean;
  written: string[];
  skipped: string[];
  errors: string[];
  client: InitClient;
} {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const force = Boolean(options.force);
  const dryRun = Boolean(options.dryRun);
  const client: InitClient = options.client ?? "all";
  const written: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  const tdir = templatesDir();
  if (!fs.existsSync(tdir)) {
    errors.push(`templates not found: ${tdir}`);
    return { ok: false, written, skipped, errors, client };
  }

  for (const item of buildPlan(cwd, client)) {
    if (!fs.existsSync(item.from)) {
      errors.push(`missing template: ${item.from}`);
      continue;
    }
    if (fs.existsSync(item.to) && !force) {
      skipped.push(
        `${item.label}: ${item.to} (exists; use --force to overwrite)`,
      );
      continue;
    }
    if (dryRun) {
      written.push(`${item.label}: ${item.to} (dry-run)`);
      continue;
    }
    fs.mkdirSync(path.dirname(item.to), { recursive: true });
    fs.copyFileSync(item.from, item.to);
    written.push(`${item.label}: ${item.to}`);
  }

  return { ok: errors.length === 0, written, skipped, errors, client };
}

export function printInitHelp(): void {
  console.log(`Usage: hitl-gate-mcp init [options]

Install IDE hooks so Agents call assess_and_gate before side effects.
Same short command for Cursor and VS Code (default: --client all).

Does NOT overwrite your live mcp.json (only *.example helpers).

Setup:
  1) Add hitl_mcp to IDE MCP config (see README / *.mcp.json.example)
  2) In project root:
       hitl-gate-mcp init
     or:
       npx hitl-gate-mcp init

Options:
  --client <name>  cursor | vscode | all (default: all)
  --cwd <dir>      Target project root (default: cwd)
  --force          Overwrite existing hook files
  --dry-run        Preview only
  -h, --help       Show help

Writes (client=all):
  Cursor:  .cursor/rules/...  .cursor/skills/...
  VS Code: .github/instructions/hitl-gate.instructions.md
           .vscode/mcp.json.example
`);
}

export function parseInitArgs(argv: string[]): InitOptions & { help?: boolean } {
  const out: InitOptions & { help?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") out.help = true;
    else if (a === "--force") out.force = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--cwd") {
      out.cwd = argv[++i];
    } else if (a.startsWith("--cwd=")) {
      out.cwd = a.slice("--cwd=".length);
    } else if (a === "--client") {
      out.client = parseClient(argv[++i]);
    } else if (a.startsWith("--client=")) {
      out.client = parseClient(a.slice("--client=".length));
    }
  }
  return out;
}

function parseClient(raw: string | undefined): InitClient {
  const v = (raw ?? "all").trim().toLowerCase();
  if (v === "cursor" || v === "vscode" || v === "all") return v;
  throw new Error(`invalid --client: ${raw} (use cursor|vscode|all)`);
}

/** CLI entry when invoked as `hitl-gate-mcp init ...` */
export function cliInitMain(argv: string[]): number {
  let opts: InitOptions & { help?: boolean };
  try {
    opts = parseInitArgs(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
  if (opts.help) {
    printInitHelp();
    return 0;
  }
  const result = runInit(opts);
  console.log(`Client target: ${result.client}`);
  if (result.written.length) {
    console.log("Written:");
    for (const w of result.written) console.log(`  + ${w}`);
  }
  if (result.skipped.length) {
    console.log("Skipped:");
    for (const s of result.skipped) console.log(`  · ${s}`);
  }
  if (result.errors.length) {
    console.error("Errors:");
    for (const e of result.errors) console.error(`  ! ${e}`);
    return 1;
  }
  console.log("");
  console.log("Next:");
  console.log("  1) Merge MCP config from *.mcp.json.example into your IDE");
  console.log("     Cursor:  .cursor/mcp.json  (shape: mcpServers)");
  console.log("     VS Code: .vscode/mcp.json  (shape: servers)");
  console.log("  2) Reload MCP / reopen the project");
  console.log(
    "  3) If elicitation form missing: set HITL_ENABLE_PANEL=1 or use chat fallback",
  );
  return 0;
}
