import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const isWindows = process.platform === "win32";
const npmCmd = isWindows ? "npm.cmd" : "npm";

const archetypes = new Set([
  "BEDX",
  "GONE",
  "SIDE",
  "SPRK",
  "F1SH",
  "NOCT",
  "UNDO",
  "MUT8",
  "BUFR",
  "JANK",
  "FINE",
  "GL1T",
]);

const options = parseArgs(process.argv.slice(2));
const generatorArgs = buildGeneratorArgs(options);

console.log("[assets] Generating Personality Escape Station fixed assets");
console.log(`[assets] Target: ${options.archetype ?? "all archetypes"}`);
console.log(`[assets] Mode: ${options.dryRun ? "dry-run" : options.publish ? "publish" : "run output"}`);
if (options.only) {
  console.log(`[assets] Only: ${options.only}`);
}
if (options.force) {
  console.log("[assets] Force: enabled for selected asset scope");
}

run("generate:fixed-assets", ["run", "generate:fixed-assets", "--", ...generatorArgs]);

const shouldVerify = !options.skipVerify && !options.dryRun && options.publish && !options.only;
if (shouldVerify) {
  if (options.archetype) {
    run("verify:fixed-asset", ["run", "verify:fixed-asset", "--", options.archetype]);
  } else {
    run("verify:fixed-assets:strict", ["run", "verify:fixed-assets:strict"]);
  }
} else if (!options.skipVerify) {
  console.log("[assets] Skipping strict verification for dry-run, non-publish, or partial generation.");
}

console.log("[assets] Done.");

function parseArgs(args) {
  const options = {
    all: false,
    archetype: undefined,
    dryRun: false,
    publish: true,
    only: undefined,
    force: false,
    skipPlayer: false,
    proceduralPlayer: false,
    skipVerify: false,
    sourceCharacterDir: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--all") {
      options.all = true;
      continue;
    }
    if (arg === "--archetype") {
      options.archetype = requireValue(args, index, arg).toUpperCase();
      index += 1;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      options.publish = false;
      continue;
    }
    if (arg === "--publish") {
      options.publish = true;
      continue;
    }
    if (arg === "--no-publish") {
      options.publish = false;
      continue;
    }
    if (arg === "--only") {
      options.only = normalizeOnly(requireValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--maps-only" || arg === "--map-only") {
      options.only = "map";
      continue;
    }
    if (arg === "--player-only") {
      options.only = "player";
      continue;
    }
    if (arg === "--force") {
      options.force = true;
      continue;
    }
    if (arg === "--skip-player" || arg === "--non-player") {
      options.skipPlayer = true;
      continue;
    }
    if (arg === "--procedural-player") {
      options.proceduralPlayer = true;
      continue;
    }
    if (arg === "--skip-verify") {
      options.skipVerify = true;
      continue;
    }
    if (arg === "--source-character-dir") {
      options.sourceCharacterDir = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}\nRun npm run assets:generate -- --help for usage.`);
  }

  if (!options.archetype) {
    options.all = true;
  }
  if (options.archetype && !archetypes.has(options.archetype)) {
    throw new Error(`Unknown archetype: ${options.archetype}`);
  }
  if (options.all && options.archetype) {
    throw new Error("Use either --all or --archetype <ID>, not both.");
  }
  if (options.sourceCharacterDir && options.only !== "player") {
    throw new Error("--source-character-dir requires --only player or --player-only.");
  }
  if (options.skipPlayer && options.only === "player") {
    throw new Error("--skip-player cannot be combined with --only player.");
  }
  if (options.skipPlayer && options.proceduralPlayer) {
    throw new Error("--skip-player cannot be combined with --procedural-player.");
  }

  return options;
}

function buildGeneratorArgs(options) {
  const args = [];
  if (options.all) {
    args.push("--all");
  } else {
    args.push("--archetype", options.archetype);
  }
  if (options.dryRun) {
    args.push("--dry-run");
  }
  if (options.publish) {
    args.push("--publish");
  }
  if (options.only) {
    args.push("--only", options.only);
  }
  if (options.force) {
    args.push("--force");
  }
  if (options.skipPlayer) {
    args.push("--skip-player");
  }
  if (options.proceduralPlayer) {
    args.push("--procedural-player");
  }
  if (options.sourceCharacterDir) {
    args.push("--source-character-dir", options.sourceCharacterDir);
  }
  return args;
}

function normalizeOnly(value) {
  if (value === "map" || value === "player" || value.startsWith("hotspot:")) {
    return value;
  }
  throw new Error("Use --only map, --only player, or --only hotspot:<id>.");
}

function requireValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function run(label, args) {
  console.log(`[assets] npm ${args.join(" ")}`);
  const result = spawnSync(npmCmd, args, {
    cwd: root,
    stdio: "inherit",
    shell: isWindows,
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed with status ${result.status}`);
  }
}

function printHelp() {
  console.log(`Personality Escape Station asset generator

Usage:
  npm run assets:generate
  npm run assets:generate -- --archetype BEDX
  npm run assets:generate -- --all --only map --force
  npm run assets:generate -- --archetype BEDX --only player --force
  npm run assets:generate -- --all --dry-run

Defaults:
  - No target means --all.
  - Generation publishes to client/public/personality-assets/fixed.
  - Full publish runs strict verification automatically.

Options:
  --all                         Generate all 12 fixed personality assets.
  --archetype <ID>              Generate one archetype, e.g. BEDX or GL1T.
  --dry-run                     Write prompts/manifests only; no image API calls.
  --no-publish                  Write to output/personality-assets/runs instead of public assets.
  --only <scope>                map, player, or hotspot:<id>.
  --maps-only, --map-only       Alias for --only map.
  --player-only                 Alias for --only player.
  --force                       Regenerate selected scope instead of reusing existing files.
  --skip-player, --non-player   Generate maps, props, and agents without retrying player sheets.
  --procedural-player           Generate deterministic 8x8 player frames instead of calling image API.
  --skip-verify                 Skip automatic strict verification.
  --source-character-dir <dir>  Reuse a generated player spritesheet directory with --only player.
`);
}
