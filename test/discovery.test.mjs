import test from "node:test";
import assert from "node:assert/strict";
import { discoverProjects } from "../scripts/lib/github.mjs";

function repository(index) {
  return {
    full_name: `owner/agent-${index}`,
    name: `agent-${index}`,
    description: "An AI agent runtime",
    topics: ["ai-agent"],
    default_branch: "main",
    html_url: `https://github.com/owner/agent-${index}`,
    stargazers_count: 10_000 - index,
    forks_count: 100,
    open_issues_count: 2,
    pushed_at: "2026-10-09T00:00:00Z",
  };
}
const readme = "# Agent Runtime\n\n" + "A complete AI agent application with tools, installation and examples. ".repeat(8);

function mockGitHub(t, { pages, valid = () => true, failSearch = () => false, failRepository = false, incomplete = false }) {
  const calls = [];
  t.mock.method(console, "warn", () => {});
  t.mock.method(globalThis, "fetch", async (input) => {
    const url = new URL(input);
    calls.push(url);
    let payload;
    if (url.pathname === "/search/repositories") {
      if (failSearch(url)) return new Response('{"message":"forbidden"}', { status: 403 });
      const page = Number(url.searchParams.get("page"));
      payload = {
        items: pages[page - 1] || [],
        total_count: pages.flat().length,
        incomplete_results: incomplete,
      };
    } else if (url.pathname.includes("/git/trees/")) {
      if (failRepository) return new Response('{"message":"forbidden"}', { status: 403 });
      const name = url.pathname.split("/")[3];
      payload = { tree: [
        { type: "blob", path: "README.md" },
        ...(valid(name) ? [{ type: "blob", path: "src/agent.ts" }] : []),
      ] };
    } else if (url.pathname.includes("/contents/README.md")) {
      payload = { encoding: "base64", content: Buffer.from(readme).toString("base64") };
    } else {
      throw new Error(`Unexpected request: ${url.pathname}`);
    }
    return new Response(JSON.stringify(payload));
  });
  return calls;
}

const firstPage = Array.from({ length: 30 }, (_, i) => repository(i));

test("首批全为历史项目时不读取旧仓库，继续次页发现新项目", async (t) => {
  const calls = mockGitHub(t, { pages: [firstPage, [repository(30)]] });
  const projects = await discoverProjects({
    maxRepositories: 1,
    excludedRepositories: firstPage.map((repo) => repo.full_name.toUpperCase()),
  });
  assert.deepEqual(projects.map((project) => project.repository), ["owner/agent-30"]);
  assert.equal(calls.filter((url) => url.pathname === "/search/repositories").length, 8);
  assert.equal(calls.filter((url) => url.pathname.startsWith("/repos/")).length, 2);
});

test("首批全不合格时继续次页，拒绝项不占合格候选名额", async (t) => {
  const calls = mockGitHub(t, { pages: [firstPage, [repository(30)]], valid: (name) => name === "agent-30" });
  const projects = await discoverProjects({ maxRepositories: 1 });
  assert.equal(projects[0].repository, "owner/agent-30");
  // Four overlapping sources validate each repository once.
  assert.equal(calls.filter((url) => url.pathname.includes("/git/trees/")).length, 31);
});

test("首批部分通过但不足时继续补足，不只在零候选时翻页", async (t) => {
  mockGitHub(t, { pages: [firstPage, [repository(30)]], valid: (name) => ["agent-0", "agent-30"].includes(name) });
  const projects = await discoverProjects({ maxRepositories: 2 });
  assert.deepEqual(projects.map((project) => project.repository), ["owner/agent-0", "owner/agent-30"]);
});

test("每个来源真正耗尽时返回空候选，不重复历史", async (t) => {
  const calls = mockGitHub(t, { pages: [[repository(0)]] });
  assert.deepEqual(await discoverProjects({ excludedRepositories: ["owner/agent-0"] }), []);
  assert.equal(calls.length, 4);
});

test("来源全部不可用时不能报告真正耗尽", async (t) => {
  mockGitHub(t, { pages: [], failSearch: () => true });
  await assert.rejects(discoverProjects(), { code: "SOURCE_UNAVAILABLE" });
});

test("部分来源失败且其余为空时不能报告真正耗尽", async (t) => {
  mockGitHub(t, { pages: [], failSearch: (url) => url.searchParams.get("q").includes("topic:ai-agent") });
  await assert.rejects(discoverProjects(), { code: "SOURCE_UNAVAILABLE" });
});

test("部分来源失败仍可使用其他来源的合格新项目", async (t) => {
  mockGitHub(t, { pages: [[repository(0)]], failSearch: (url) => url.searchParams.get("q").includes("topic:ai-agent") });
  assert.equal((await discoverProjects({ maxRepositories: 1 }))[0].repository, "owner/agent-0");
});

test("仓库读取失败与资格不合格分别处理", async (t) => {
  mockGitHub(t, { pages: [[repository(0)]], failRepository: true });
  await assert.rejects(discoverProjects(), { code: "SOURCE_UNAVAILABLE" });
});

test("搜索结果不完整时不能报告真正耗尽", async (t) => {
  mockGitHub(t, { pages: [], incomplete: true });
  await assert.rejects(discoverProjects({ maxSearchPages: 1 }), { code: "SOURCE_UNAVAILABLE" });
});

test("分页上限与真正耗尽分别处理", async (t) => {
  mockGitHub(t, { pages: [firstPage, [repository(30)]] });
  await assert.rejects(discoverProjects({ maxSearchPages: 1, excludedRepositories: firstPage.map((repo) => repo.full_name) }), { code: "DISCOVERY_LIMIT" });
});

test("请求预算包含仓库校验，达到上限立即停止", async (t) => {
  const calls = mockGitHub(t, { pages: [[repository(0)]] });
  await assert.rejects(discoverProjects({ maxApiRequests: 5 }), { code: "DISCOVERY_LIMIT" });
  assert.equal(calls.length, 5);
});

test("预算用尽但已有合格新项目时继续推荐", async (t) => {
  const calls = mockGitHub(t, { pages: [[repository(0), repository(1)]] });
  assert.equal((await discoverProjects({ maxApiRequests: 6 }))[0].repository, "owner/agent-0");
  assert.equal(calls.length, 6);
});

test("无效预算立即报错，避免静默得到空候选", async () => {
  for (const options of [{ maxRepositories: NaN }, { maxApiRequests: 0 }, { maxSearchPages: 35 }]) {
    await assert.rejects(discoverProjects(options), /必须是/);
  }
});
