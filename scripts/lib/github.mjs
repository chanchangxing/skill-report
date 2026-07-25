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

async function searchRepositories(query) {
  const params = new URLSearchParams({
    q: query,
    sort: "stars",
    order: "desc",
    per_page: "30",
  });
  const payload = await fetchJson(api(`/search/repositories?${params}`), {
    headers: githubHeaders(),
  });
  return payload.items || [];
}

async function repositoryTree(repository) {
  const branch = encodeURIComponent(repository.default_branch);
  const payload = await fetchJson(
    api(`/repos/${repository.full_name}/git/trees/${branch}?recursive=1`),
    { headers: githubHeaders() },
  );
  return payload.tree || [];
}

async function repositoryFile(repository, filePath) {
  const encoded = filePath.split("/").map(encodeURIComponent).join("/");
  const url = api(
    `/repos/${repository.full_name}/contents/${encoded}?ref=${encodeURIComponent(repository.default_branch)}`,
  );
  const payload = await fetchJson(url, { headers: githubHeaders() });
  if (payload.encoding !== "base64" || !payload.content) return "";
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

async function projectFromRepository(repository) {
  const tree = await repositoryTree(repository);
  const readmePath = rootReadmePath(tree);
  if (!readmePath) throw new Error("仓库根目录没有 README");
  const readme = await repositoryFile(repository, readmePath);
  if (!looksLikeAgentProject(repository, readme, tree)) {
    throw new Error("仓库未通过完整智能体项目校验");
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

export async function discoverProjects({ maxRepositories = 35 } = {}) {
  const searches = await Promise.allSettled(SEARCH_QUERIES.map(searchRepositories));
  const repositories = new Map();
  for (const result of searches) {
    if (result.status !== "fulfilled") {
      console.warn(`GitHub 搜索失败，继续使用其他来源：${result.reason.message}`);
      continue;
    }
    for (const repository of result.value) {
      if (repository.archived || repository.disabled || repository.fork) continue;
      repositories.set(repository.full_name, repository);
    }
  }

  const rankedRepositories = [...repositories.values()]
    .sort((a, b) => b.stargazers_count - a.stargazers_count)
    .slice(0, maxRepositories);
  const projects = [];

  for (const repository of rankedRepositories) {
    try {
      projects.push(await projectFromRepository(repository));
    } catch (error) {
      console.warn(`跳过 ${repository.full_name}：${error.message}`);
    }
  }
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
