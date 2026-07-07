const { spawnSync } = require("child_process");
const path = require("path");

const root = path.join(__dirname, "..");
const mock = path.join(__dirname, "mock-server-only.cjs");
const script = path.join(__dirname, "backfill-rag-meta.ts");

const env = {
  ...process.env,
  NODE_OPTIONS: `--require ${mock}`,
};

const result = spawnSync("npx", ["tsx", script], {
  stdio: "inherit",
  env,
  cwd: root,
  shell: true,
});

process.exit(result.status ?? 1);
