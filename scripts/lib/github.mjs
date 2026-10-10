import path from "node:path";
import { clean, daysAgo, fetchJson, githubHeaders } from "./utils.mjs";

const API = "https://api.github.com";
const SEARCH_QUERIES = [
  "topic:ai-agent archived:false",
  "topic:agentic-ai archived:false",
  "\"AI agent\" in:name,description,readme archived:false",
  "\"agent skill\" in:name,description,readme archived:false",
];

function api(pathname) {
  return `${API}${pathname}`;
}

async function searchRepositories(query, page, request) {
  const params = new URLSearchParams({
    q: query,
    sort: "stars",
    order: "desc",
    per_page: "30",
    page: String(page),
  });
  const payload = await request(api(`/search/repositories?${params}`), {
    headers: githubHeaders(),
  });
  if (!Array.isArray(payload.items) || !Number.isFinite(payload.total_count)) {
    throw new Error("GitHub 搜索响应缺少 items 或 total_count");
  }
  return payload;
}

async function repositoryTree(repository, request = fetchJson) {
  const branch = encodeURIComponent(repository.default_branch);
  const payload = await request(
    api(`/repos/${repository.full_name}/git/trees/${branch}?recursive=1`),
    { headers: githubHeaders() },
  );
  if (!Array.isArray(payload.tree) || payload.truncated) {
    throw new Error("GitHub 仓库文件树不完整，无法确认项目资格");
  }
  return payload.tree;
}

async function repositoryFile(repository, filePath, request = fetchJson) {
  const encoded = filePath.split("/").map(encodeURIComponent).join("/");
  const url = api(
    `/repos/${repository.full_name}/contents/${encoded}?ref=${encodeURIComponent(repository.default_branch)}`,
  );
  const payload = await request(url, { headers: githubHeaders() });
  if (payload.encoding !== "base64" || !payload.content) {
    throw new Error("GitHub 文件内容不可用");
  }
  return Buffer.from(payload.content, "base64").toString("utf8");
}

function frontmatter(markdown) {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result = {};
  for (const line of match[1].split("\n")) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    result[key] = value;
  }
  return result;
}

function rootReadmePath(tree) {
  return tree
    .filter((item) => item.type === "blob" && /^readme(?:\.[^.]+)?$/i.test(item.path))
    .map((item) => item.path)
    .sort((a, b) => a.length - b.length)[0] || "";
}

function hasImplementation(tree) {
  const implementationFile = /\.(?:c|cc|cpp|cs|go|java|js|jsx|kt|kts|mjs|php|py|rb|rs|sh|swift|ts|tsx)$/i;
  const projectManifest = /(^|\/)(?:cargo\.toml|composer\.json|dockerfile|go\.mod|package\.json|pyproject\.toml|requirements\.txt)$/i;
  return tree.some((item) =>
    item.type === "blob" && (implementationFile.test(item.path) || projectManifest.test(item.path)));
}

export function looksLikeAgentProject(repository, readme, tree = []) {
  const repositoryIdentity = clean([
    repository.name,
    repository.description,
    ...(repository.topics || []),
  ].join(" "));
  const readmeIdentity = clean(readme.slice(0, 6_000));
  const collectionSignals = /(^|[\/_-])awesome([\/_-]|$)|curated\s+list|collection\s+of\s+(?:agent\s+)?skills|资源列表|链接合集/i;
  const agentSignals = /\bai[- ]?agents?\b|\bagentic\b|\bautonomous agents?\b|\bmulti[- ]agent\b|\bagent framework\b|\bagent skills?\b|人工智能智能体|智能体框架|自主智能体/i;
  const rootSkill = tree.some((item) => item.type === "blob" && /^SKILL\.md$/i.test(item.path));

  return Boolean(
    readme.length >= 300
    && !collectionSignals.test(clean(`${repository.name} ${repository.description || ""}`))
    && (agentSignals.test(repositoryIdentity) || (rootSkill && agentSignals.test(readmeIdentity)))
    && (hasImplementation(tree) || rootSkill),
  );
}

function projectDescription(readme, repository) {
  const meta = frontmatter(readme);
  const withoutFrontmatter = readme.replace(/^---[\s\S]*?---/, "");
  const paragraph = withoutFrontmatter
    .split(/\n\s*\n/)
    .map(clean)
    .find((item) => item && !item.startsWith("#") && !item.startsWith("-") && !item.startsWith("!"));
  return clean(repository.description || meta.description || paragraph || "暂无描述").slice(0, 500);
}

function referencedPaths(markdown, documentPath, treePaths) {
  const base = path.posix.dirname(documentPath);
  const results = new Set();
  for (const match of markdown.matchAll(/\[[^\]]*]\(([^)#?]+)(?:[)#?][^)]*)?\)/g)) {
    let link = match[1];
    try {
      link = decodeURIComponent(link);
    } catch {
      // Keep malformed-but-readable paths as-is; validation below is authoritative.
    }
    link = link.replace(/^\.?\//, "");
    if (/^(https?:|mailto:)/i.test(link)) continue;
    const resolved = path.posix.normalize(path.posix.join(base, link));
    if (treePaths.has(resolved) && /\.(?:md|mdx|txt)$/i.test(resolved)) results.add(resolved);
  }
  return [...results];
}

function projectReferencePaths(readme, readmePath, tree) {
  const treePaths = new Set(tree.filter((item) => item.type === "blob").map((item) => item.path));
  const preferredPatterns = [
    /^SKILL\.md$/i,
    /(^|\/)ARCHITECTURE\.md$/i,
    /^docs\/(?:architecture|design|how-it-works|overview)\.(?:md|mdx)$/i,
  ];
  const preferred = tree
    .filter((item) => item.type === "blob" && preferredPatterns.some((pattern) => pattern.test(item.path)))
    .map((item) => item.path);
  return [...new Set([
    ...preferred,
    ...referencedPaths(readme, readmePath, treePaths),
  ])].filter((item) => item !== readmePath).slice(0, 6);
}

function discoveryError(code, message) {
  return Object.assign(new Error(message), { code });
}

async function projectFromRepository(repository, request = fetchJson) {
  const tree = await repositoryTree(repository, request);
  const readmePath = rootReadmePath(tree);
  if (!readmePath) throw discoveryError("INELIGIBLE_PROJECT", "仓库根目录没有 README");
  const readme = await repositoryFile(repository, readmePath, request);
  if (!looksLikeAgentProject(repository, readme, tree)) {
    throw discoveryError("INELIGIBLE_PROJECT", "仓库未通过完整智能体项目校验");
  }
  return {
    id: repository.full_name,
    projectId: repository.full_name,
    projectSha: repository.node_id || repository.full_name,
    repository: repository.full_name,
    repositoryUrl: repository.html_url,
    projectUrl: repository.html_url,
    homepageUrl: repository.homepage || "",
    primaryDocumentPath: readmePath,
    name: repository.name,
    description: projectDescription(readme, repository),
    markdown: readme,
    referencedPaths: projectReferencePaths(readme, readmePath, tree),
    stars: repository.stargazers_count,
    forks: repository.forks_count,
    openIssues: repository.open_issues_count,
    pushedAt: repository.pushed_at,
    updatedAt: repository.updated_at,
    language: repository.language,
    topics: repository.topics || [],
    defaultBranch: repository.default_branch,
  };
}

export async function loadProject(repositoryName) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repositoryName)) {
    throw new Error("项目名称必须使用 owner/repository 格式");
  }
  const repository = await fetchJson(api(`/repos/${repositoryName}`), {
    headers: githubHeaders(),
  });
  return projectFromRepository(repository);
}

export async function discoverProjects({
  maxRepositories = 35,
  excludedRepositories = [],
  maxSearchPages = 5,
  maxApiRequests = 200,
} = {}) {
  for (const [name, value, maximum] of [
    ["maxRepositories", maxRepositories, 100],
    ["maxSearchPages", maxSearchPages, 34],
    ["maxApiRequests", maxApiRequests, 1000],
  ]) {
    if (!Number.isInteger(value) || value < 1 || value > maximum) {
      throw new Error(`${name} 必须是 1 到 ${maximum} 之间的整数`);
    }
  }
  let requests = 0;
  const request = (url, options) => fetchJson(url, {
    ...options,
    beforeRequest() {
      if (requests >= maxApiRequests) {
        throw discoveryError("DISCOVERY_LIMIT", "GitHub 发现请求预算已用完，无法确认是否耗尽；未生成空报告。");
      }
      requests += 1;
    },
  });
  const seen = new Set([...excludedRepositories].map((name) => name.toLowerCase()));
  const sources = SEARCH_QUERIES.map((query) => ({ query, done: false }));
  const projects = [];
  let sourceUnavailable = false;

  try {
    for (let page = 1; page <= maxSearchPages; page += 1) {
      const repositories = new Map();
      for (const source of sources.filter((item) => !item.done)) {
        try {
          const payload = await searchRepositories(source.query, page, request);
          sourceUnavailable ||= Boolean(payload.incomplete_results);
          source.done = !payload.incomplete_results
            && payload.total_count <= page * 30;
          for (const repository of payload.items) {
            const name = repository.full_name.toLowerCase();
            if (seen.has(name) || repository.archived || repository.disabled || repository.fork) continue;
            repositories.set(name, repository);
          }
        } catch (error) {
          if (error.code === "DISCOVERY_LIMIT") throw error;
          sourceUnavailable = true;
          source.done = true;
          console.warn(`GitHub 搜索失败，继续使用其他来源：${error.message}`);
        }
      }
      const rankedRepositories = [...repositories.values()]
        .sort((a, b) => b.stargazers_count - a.stargazers_count);
      for (const repository of rankedRepositories) {
        seen.add(repository.full_name.toLowerCase());
        try {
          projects.push(await projectFromRepository(repository, request));
        } catch (error) {
          if (error.code === "DISCOVERY_LIMIT") throw error;
          if (error.code !== "INELIGIBLE_PROJECT") sourceUnavailable = true;
          console.warn(`跳过 ${repository.full_name}：${error.message}`);
        }
        if (projects.length >= maxRepositories) return projects;
      }
      if (sources.every((source) => source.done)) break;
    }
  } catch (error) {
    if (error.code !== "DISCOVERY_LIMIT" || !projects.length) throw error;
    console.warn(`${error.message} 使用已验证的 ${projects.length} 个新项目继续推荐。`);
  }
  if (projects.length) return projects;
  if (sourceUnavailable) {
    throw discoveryError("SOURCE_UNAVAILABLE", "GitHub 来源不可用或响应不完整，无法确认是否耗尽；未生成空报告。");
  }
  if (sources.some((source) => !source.done)) {
    throw discoveryError("DISCOVERY_LIMIT", "GitHub 搜索分页上限已到，无法确认是否耗尽；未生成空报告。");
  }
  // An empty result is authoritative only after every source was fully inspected.
  return projects;
}

export async function enrichCandidate(candidate, date) {
  const since = `${daysAgo(date, 7)}T00:00:00Z`;
  const params = new URLSearchParams({
    state: "all",
    since,
    per_page: "100",
    sort: "updated",
    direction: "desc",
  });
  let issueActivity7d = 0;
  try {
    const issues = await fetchJson(
      api(`/repos/${candidate.repository}/issues?${params}`),
      { headers: githubHeaders() },
    );
    issueActivity7d = issues.filter((item) => !item.pull_request).length;
  } catch (error) {
    console.warn(`无法获取 ${candidate.repository} 的议题活跃度：${error.message}`);
  }

  const files = [];
  for (const filePath of candidate.referencedPaths) {
    try {
      const content = await repositoryFile(
        { full_name: candidate.repository, default_branch: candidate.defaultBranch },
        filePath,
      );
      files.push({ path: filePath, content: content.slice(0, 18_000) });
    } catch (error) {
      console.warn(`无法读取项目资料 ${filePath}：${error.message}`);
    }
  }
  return { ...candidate, issueActivity7d, referencedFiles: files };
}
