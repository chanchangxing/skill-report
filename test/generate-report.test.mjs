import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const script = path.join(root, "scripts/generate-report.mjs");

async function setup(t) {
  const workspace = await mkdtemp(path.join(tmpdir(), "skill-report-test-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  for (const directory of ["data", "docs", "static"]) {
    await cp(path.join(root, directory), path.join(workspace, directory), { recursive: true });
  }
  return workspace;
}

async function filesIn(directory) {
  const files = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(files, await filesIn(file));
    else files[file] = await readFile(file, "utf8");
  }
  return files;
}

function mockModule(mode, historical) {
  return `
    import { appendFile } from "node:fs/promises";
    const mode = ${JSON.stringify(mode)};
    const historical = ${JSON.stringify(historical)};
    globalThis.fetch = async (input) => {
      const url = new URL(input);
      await appendFile("requests.jsonl", JSON.stringify(input) + "\\n");
      if (url.hostname !== "api.github.com") throw new Error("Unexpected external service");
      let payload;
      if (url.pathname === "/search/repositories") {
        if (mode === "unavailable") return new Response('{}', { status: 403 });
        const old = { full_name: historical, default_branch: "main", stargazers_count: 20000 };
        const fresh = {
          full_name: "fixture/new-agent", name: "new-agent", description: "An AI agent runtime",
          default_branch: "main", html_url: "https://github.com/fixture/new-agent",
          stargazers_count: 9000, forks_count: 100, open_issues_count: 3,
          pushed_at: "2026-10-09T00:00:00Z", topics: ["ai-agent"], language: "TypeScript",
        };
        payload = mode === "exhausted"
          ? { items: [old], total_count: 1, incomplete_results: false }
          : { items: Number(url.searchParams.get("page")) === 1 ? Array(30).fill(old) : [fresh], total_count: 31, incomplete_results: false };
      } else if (url.pathname.includes("/git/trees/")) {
        payload = { tree: [{ type: "blob", path: "README.md" }, { type: "blob", path: "src/agent.ts" }] };
      } else if (url.pathname.includes("/contents/README.md")) {
        payload = { encoding: "base64", content: Buffer.from("# AI Agent\\n\\n" + "Complete AI agent runtime with tools and installation steps. ".repeat(10)).toString("base64") };
      } else if (url.pathname.endsWith("/issues")) {
        payload = [];
      } else throw new Error("Unexpected API request: " + input);
      return new Response(JSON.stringify(payload));
    };
  `;
}

async function generate(workspace, mode, historical) {
  const module = `data:text/javascript,${encodeURIComponent(mockModule(mode, historical))}`;
  return exec(process.execPath, ["--import", module, script], {
    cwd: workspace,
    env: {
      ...process.env,
      GITHUB_TOKEN: "",
      DEEPSEEK_API_KEY: mode === "success" ? "" : "test-must-not-be-used",
      REPORT_DATE: "2026-10-10",
      REPORT_MODE: "daily",
      MAX_REPOSITORIES: "1",
      MAX_SEARCH_PAGES: "5",
      MAX_DISCOVERY_REQUESTS: "200",
    },
  });
}

for (const [mode, message] of [["exhausted", /搜索结果已耗尽/], ["unavailable", /来源不可用/]]) {
  test(`完整生成器 ${mode} 时不调用 DeepSeek，旧站点、历史与快照保持原样`, async (t) => {
    const workspace = await setup(t);
    const history = JSON.parse(await readFile(path.join(workspace, "data/history.json"), "utf8"));
    const before = { ...await filesIn(path.join(workspace, "data")), ...await filesIn(path.join(workspace, "docs")) };
    await assert.rejects(generate(workspace, mode, history[0].repository), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, message);
      assert.doesNotMatch(error.stderr, /Unexpected external service/);
      return true;
    });
    const after = { ...await filesIn(path.join(workspace, "data")), ...await filesIn(path.join(workspace, "docs")) };
    assert.deepEqual(after, before);
    const calls = (await readFile(path.join(workspace, "requests.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
    assert.ok(calls.every((url) => new URL(url).pathname === "/search/repositories"));
  });
}

test("完整生成器从全历史首批翻页到新项目后成功生成规则报告和站点", async (t) => {
  const workspace = await setup(t);
  const oldHistory = JSON.parse(await readFile(path.join(workspace, "data/history.json"), "utf8"));
  const result = await generate(workspace, "success", oldHistory[0].repository);
  assert.match(result.stdout, /已生成 2026-10-10/);
  const history = JSON.parse(await readFile(path.join(workspace, "data/history.json"), "utf8"));
  assert.equal(history.length, oldHistory.length + 1);
  assert.equal(history.at(-1).repository, "fixture/new-agent");
  assert.equal(history.at(-1).analysis.source, "fallback");
  assert.equal(new Set(history.map((item) => item.repository.toLowerCase())).size, history.length);
  const snapshot = JSON.parse(await readFile(path.join(workspace, "data/snapshots/2026-10-10.json"), "utf8"));
  assert.deepEqual(snapshot.map((item) => item.repository), ["fixture/new-agent"]);
  assert.match(await readFile(path.join(workspace, "docs/index.html"), "utf8"), /fixture\/new-agent/);
  assert.match(await readFile(path.join(workspace, "docs/reports/2026-10-10.html"), "utf8"), /fixture\/new-agent/);
});
