import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface InitOptions {
  cwd?: string;
  force?: boolean;
  dryRun?: boolean;
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
}

function buildPlan(cwd: string): CopyPlan[] {
  const t = templatesDir();
  return [
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
  ];
}

/**
 * Copy Rule/Skill templates into the project (.cursor/...).
 * Does not modify mcp.json — configure MCP first, then run init.
 */
export function runInit(options: InitOptions = {}): {
  ok: boolean;
  written: string[];
  skipped: string[];
  errors: string[];
} {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const force = Boolean(options.force);
  const dryRun = Boolean(options.dryRun);
  const written: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];

  const tdir = templatesDir();
  if (!fs.existsSync(tdir)) {
    errors.push(`templates not found: ${tdir}`);
    return { ok: false, written, skipped, errors };
  }

  for (const item of buildPlan(cwd)) {
    if (!fs.existsSync(item.from)) {
      errors.push(`missing template: ${item.from}`);
      continue;
    }
    if (fs.existsSync(item.to) && !force) {
      skipped.push(`${item.label}: ${item.to} (exists; use --force to overwrite)`);
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

  return { ok: errors.length === 0, written, skipped, errors };
}

export function printInitHelp(): void {
  console.log(`Usage: hitl-gate-mcp init [options]

Install Cursor Rule + Skill into the current project.
Does NOT configure mcp.json.

Setup (once):
  1) IDE mcp.json → "args": ["-y", "hitl-gate-mcp"]
  2) In your project root:
       hitl-gate-mcp init
     or:
       npx hitl-gate-mcp init

Options:
  --cwd <dir>   Target project root (default: cwd)
  --force       Overwrite existing files
  --dry-run     Preview only
  -h, --help    Show help
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
    }
  }
  return out;
}

/** CLI entry when invoked as `hitl-gate-mcp init ...` */
export function cliInitMain(argv: string[]): number {
  const opts = parseInitArgs(argv);
  if (opts.help) {
    printInitHelp();
    return 0;
  }
  const result = runInit(opts);
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
  console.log("  1) Ensure mcp.json already has hitl_mcp (npx -y hitl-gate-mcp)");
  console.log("  2) Reload MCP / reopen the IDE project");
  console.log("  3) Soft guidance alone is not 100%; Rule/Skill raise compliance");
  return 0;
}
