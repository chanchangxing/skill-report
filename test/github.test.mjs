import test from "node:test";
import assert from "node:assert/strict";
import { looksLikeAgentProject } from "../scripts/lib/github.mjs";

const repository = {
  name: "agent-runtime",
  description: "An open-source AI agent runtime for tool-using assistants",
  topics: ["ai-agent", "agentic-ai"],
};

const implementationTree = [
  { type: "blob", path: "README.md" },
  { type: "blob", path: "src/agent.ts" },
  { type: "blob", path: "skills/research/SKILL.md" },
];

test("完整智能体项目可以包含内部 Skill 文件", () => {
  const readme = `# Agent Runtime

Agent Runtime is an open-source AI agent application with tools, memory and workflows.

## Architecture

The runtime accepts tasks, plans tool calls, executes actions and verifies results.
It contains installation instructions, source code and examples for production use.
Developers can install the package, configure a model provider, connect tools and
run the included examples. The repository contains the complete implementation,
not merely a list of links or one instruction file inside an unrelated project.
`;
  assert.equal(looksLikeAgentProject(repository, readme, implementationTree), true);
});

test("纯 Skill 链接合集不会被当成项目", () => {
  const readme = `# Awesome Agent Skills

A curated list and collection of agent skills from many unrelated repositories.

${"- [Example skill](https://example.com)\n".repeat(30)}
`;
  assert.equal(looksLikeAgentProject(
    { ...repository, name: "awesome-agent-skills", description: "A curated list" },
    readme,
    [{ type: "blob", path: "README.md" }],
  ), false);
});

test("仅在 README 中提到智能体的普通项目不会入选", () => {
  const readme = `# Developer Roadmap

Interactive roadmaps and educational content for developers.

## Available roadmaps

Frontend, backend, DevOps, databases, AI agents and many other learning topics.
The repository contains a complete TypeScript website and community content,
but the project itself is not an AI agent, agent framework or standalone skill.
`;
  assert.equal(looksLikeAgentProject(
    {
      name: "developer-roadmap",
      description: "Interactive roadmaps and educational content for developers",
      topics: ["roadmap", "education"],
    },
    readme,
    implementationTree,
  ), false);
});
