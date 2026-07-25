import path from "node:path";
import { clean, daysAgo, fetchJson, githubHeaders } from "./utils.mjs";

const API = "https://api.github.com";
const SEARCH_QUERIES = [
  "topic:agent-skills archived:false",
  "\"agent skills\" in:name,description,readme archived:false",
  "\"SKILL.md\" in:readme archived:false",
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

function looksLikeSkill(markdown) {
  const meta = frontmatter(markdown);
  const body = markdown.replace(/^---[\s\S]*?---/, "");
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1];
  const workflowSignals = /(步骤|流程|workflow|instructions?|procedure|when to use|使用时机)/i;
  return Boolean(
    markdown.length >= 220
    && clean(meta.name || heading)
    && clean(meta.description || body).length >= 60
    && workflowSignals.test(body),
  );
}

function skillName(markdown, skillPath) {
  const meta = frontmatter(markdown);
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1];
  return clean(meta.name || heading || path.basename(path.dirname(skillPath)));
}

function skillDescription(markdown, repository) {
  const meta = frontmatter(markdown);
  const withoutFrontmatter = markdown.replace(/^---[\s\S]*?---/, "");
  const paragraph = withoutFrontmatter
    .split(/\n\s*\n/)
    .map(clean)
    .find((item) => item && !item.startsWith("#") && !item.startsWith("-"));
  return clean(meta.description || paragraph || repository.description || "暂无描述").slice(0, 500);
}

function referencedPaths(markdown, skillPath, treePaths) {
  const base = path.posix.dirname(skillPath);
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
    if (treePaths.has(resolved)) results.add(resolved);
  }
  return [...results].slice(0, 6);
}

export async function discoverSkills({ maxRepositories = 35 } = {}) {
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
  const skills = [];

  for (const repository of rankedRepositories) {
    try {
      const tree = await repositoryTree(repository);
      const treePaths = new Set(tree.filter((item) => item.type === "blob").map((item) => item.path));
      const skillFiles = tree
        .filter((item) => item.type === "blob" && /(^|\/)SKILL\.md$/i.test(item.path))
        .slice(0, 50);
      for (const file of skillFiles) {
        const markdown = await repositoryFile(repository, file.path);
        if (!looksLikeSkill(markdown)) continue;
        skills.push({
          id: `${repository.full_name}::${file.path}`,
          repository: repository.full_name,
          repositoryUrl: repository.html_url,
          skillUrl: `${repository.html_url}/blob/${repository.default_branch}/${file.path}`,
          skillPath: file.path,
          skillSha: file.sha,
          name: skillName(markdown, file.path),
          description: skillDescription(markdown, repository),
          markdown,
          referencedPaths: referencedPaths(markdown, file.path, treePaths),
          stars: repository.stargazers_count,
          forks: repository.forks_count,
          openIssues: repository.open_issues_count,
          pushedAt: repository.pushed_at,
          updatedAt: repository.updated_at,
          language: repository.language,
          topics: repository.topics || [],
          defaultBranch: repository.default_branch,
        });
      }
    } catch (error) {
      console.warn(`跳过 ${repository.full_name}：${error.message}`);
    }
  }
  return skills;
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
    console.warn(`无法获取 ${candidate.repository} 的 Issue 活跃度：${error.message}`);
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
      console.warn(`无法读取引用文件 ${filePath}：${error.message}`);
    }
  }
  return { ...candidate, issueActivity7d, referencedFiles: files };
}
