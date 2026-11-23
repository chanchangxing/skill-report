import test from "node:test";
import assert from "node:assert/strict";
import { fetchJson } from "../scripts/lib/utils.mjs";

function mockResponses(t, responses) {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    const response = responses[calls++];
    assert.ok(response, "Unexpected extra HTTP attempt");
    return response;
  });
  return () => calls;
}
const success = () => new Response('{"ok":true}');

test("429 按 Retry-After 秒数等待，支持非 JSON 限流响应", async (t) => {
  const calls = mockResponses(t, [new Response("proxy throttled", { status: 429, headers: { "Retry-After": "3" } }), success()]);
  const delays = [];
  let attempts = 0;
  assert.deepEqual(await fetchJson("https://api.github.com/test", { sleep: async (ms) => delays.push(ms), beforeRequest: () => attempts++ }), { ok: true });
  assert.deepEqual(delays, [3000]);
  assert.equal(calls(), 2);
  assert.equal(attempts, 2);
});

test("429 支持 Retry-After HTTP 日期", async (t) => {
  t.mock.method(Date, "now", () => Date.parse("2026-10-10T00:00:00Z"));
  mockResponses(t, [new Response('{}', { status: 429, headers: { "Retry-After": "Sat, 10 Oct 2026 00:00:05 GMT" } }), success()]);
  const delays = [];
  await fetchJson("https://api.github.com/test", { sleep: async (ms) => delays.push(ms) });
  assert.deepEqual(delays, [5000]);
});

test("过长 Retry-After 直接报告不可用，不提前重试", async (t) => {
  const calls = mockResponses(t, [new Response('{}', { status: 429, headers: { "Retry-After": "120" } })]);
  await assert.rejects(fetchJson("https://api.github.com/test", { sleep: async () => assert.fail("Must not sleep") }), { status: 429, retryAfterMs: 120_000 });
  assert.equal(calls(), 1);
});

test("持续 429 有限重试，最后一次失败后不额外等待", async (t) => {
  const calls = mockResponses(t, Array.from({ length: 3 }, () => new Response('{}', { status: 429, headers: { "Retry-After": "1" } })));
  const delays = [];
  await assert.rejects(fetchJson("https://api.github.com/test", { sleep: async (ms) => delays.push(ms) }), { status: 429 });
  assert.deepEqual(delays, [1000, 1600]);
  assert.equal(calls(), 3);
});

test("403 GitHub 主限流按 reset 等待", async (t) => {
  t.mock.method(Date, "now", () => 1_000_000);
  mockResponses(t, [new Response('{}', { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1004" } }), success()]);
  const delays = [];
  await fetchJson("https://api.github.com/test", { sleep: async (ms) => delays.push(ms) });
  assert.deepEqual(delays, [4000]);
});

test("404 不重试，不等待", async (t) => {
  const calls = mockResponses(t, [new Response('{}', { status: 404 })]);
  await assert.rejects(fetchJson("https://api.github.com/test", { sleep: async () => assert.fail("Must not sleep") }), { status: 404 });
  assert.equal(calls(), 1);
});

test("请求预算耗尽时重试也不得越过预算", async (t) => {
  const calls = mockResponses(t, [new Response('{}', { status: 429 })]);
  let attempts = 0;
  await assert.rejects(fetchJson("https://api.github.com/test", {
    sleep: async () => {},
    beforeRequest: () => { if (attempts++ >= 1) throw Object.assign(new Error("budget exhausted"), { code: "DISCOVERY_LIMIT" }); },
  }), { code: "DISCOVERY_LIMIT" });
  assert.equal(calls(), 1);
});
