import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const timezone = process.env.REPORT_TIMEZONE || "Australia/Perth";
const force = process.argv.includes("--force");

function reportDate() {
  if (process.env.REPORT_DATE) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(process.env.REPORT_DATE)) {
      throw new Error("REPORT_DATE 必须是 YYYY-MM-DD。");
    }
    return process.env.REPORT_DATE;
  }
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function fetchWithTimeout(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(15_000),
    headers: {
      "User-Agent": "daily-skill-report/1.0",
      Accept: "application/json, application/atom+xml;q=0.9, text/plain;q=0.8",
      ...options.headers,
    },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response;
}

function clean(text = "") {
  return text.replace(/\s+/g, " ").trim();
}

async function collectGitHub(date) {
  const query = encodeURIComponent(`created:>=${date} stars:>20`);
  const response = await fetchWithTimeout(
    `https://api.github.com/search/repositories?q=${query}&sort=stars&order=desc&per_page=8`,
    { headers: { "X-GitHub-Api-Version": "2022-11-28" } },
  );
  const json = await response.json();
  return (json.items || []).map((item) => ({
    source: "GitHub",
    title: item.full_name,
    url: item.html_url,
    signal: `${item.stargazers_count} stars；${clean(item.description || "无描述")}`,
  }));
}

async function collectHackerNews() {
  const since = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
  const response = await fetchWithTimeout(
    `https://hn.algolia.com/api/v1/search?tags=story&numericFilters=created_at_i>${since}&hitsPerPage=10`,
  );
  const json = await response.json();
  return (json.hits || []).map((item) => ({
    source: "Hacker News",
    title: clean(item.title || "Untitled"),
    url: item.url || `https://news.ycombinator.com/item?id=${item.objectID}`,
    signal: `${item.points || 0} points；${item.num_comments || 0} comments`,
  }));
}

function xmlText(entry, tag) {
  const match = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return clean(match?.[1]?.replace(/<[^>]+>/g, "") || "");
}

async function collectArxiv() {
  const response = await fetchWithTimeout(
    "https://export.arxiv.org/api/query?search_query=all:AI+OR+all:software+OR+all:design&start=0&max_results=8&sortBy=submittedDate&sortOrder=descending",
  );
  const xml = await response.text();
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((match) => {
    const entry = match[1];
    return {
      source: "arXiv",
      title: xmlText(entry, "title"),
      url: xmlText(entry, "id"),
      signal: clean(xmlText(entry, "summary")).slice(0, 220),
    };
  });
}

async function collectSignals(date) {
  const results = await Promise.allSettled([collectGitHub(date), collectHackerNews(), collectArxiv()]);
  const names = ["GitHub", "Hacker News", "arXiv"];
  const signals = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") signals.push(...result.value);
    else console.warn(`跳过 ${names[index]}：${result.reason.message}`);
  });
  if (signals.length < 3) throw new Error("可用趋势来源不足，取消生成以避免低质量报告。");
  return signals;
}

function buildPrompt(date, signals) {
  const evidence = signals.map((item, index) =>
    `${index + 1}. [${item.source}] ${item.title}\n   URL: ${item.url}\n   Signal: ${item.signal}`,
  ).join("\n");
  return `今天是 ${date}。根据下列可验证的趋势信号，挑选一个近期最值得学习、而且可以真正练习的“技能”（不是公司、单一产品或新闻事件）。\n\n${evidence}\n\n请只输出一份中文 Markdown，不能用代码围栏，必须严格采用以下结构：\n---\ndate: ${date}\nskill: 技能名称\ndomains: [领域1, 领域2]\n---\n\n# Daily Skill Report — ${date}\n\n## 今日 Skill\n\n**技能名称**\n\n- 热度：X/5\n- 领域：...\n- 学习难度：X/5\n- 长期价值：X/5\n\n## 为什么现在热门\n\n用 2–3 段说明，只将提供信号支持的事实写成事实；每段至少含一个 Markdown 链接。\n\n## 你需要掌握什么\n\n列出 3–5 项具体能力。\n\n## 7 天起步路径\n\n给出第 1–2 天、第 3–4 天、第 5–7 天的行动。\n\n## 对软件工程师的价值\n\n给出务实的适用场景；不要假设读者背景。\n\n## 今日 30 分钟行动\n\n一个能够立刻完成的练习。\n\n## 趋势来源\n\n列出 3–6 条，格式为“- [标题](URL) — 对应信号”。\n\n避免虚构数字、链接和时间；不得给出投资建议。`;
}

function responseText(payload) {
  return (payload.output || []).flatMap((item) => item.content || [])
    .filter((part) => part.type === "output_text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

async function generateWithOpenAI(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("缺少 OPENAI_API_KEY。请在 GitHub Actions Secret 或本地环境变量中设置它。");
  const response = await fetchWithTimeout("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      store: false,
      input: [
        { role: "developer", content: "你是严谨的学习趋势编辑。只使用用户提供的证据，不编造事实或链接。" },
        { role: "user", content: prompt },
      ],
    }),
  });
  const json = await response.json();
  const text = responseText(json);
  if (!text) throw new Error(`OpenAI 未返回文本：${json.error?.message || "未知错误"}`);
  return text.endsWith("\n") ? text : `${text}\n`;
}

function skillFromReport(markdown) {
  return markdown.match(/^skill:\s*(.+)$/m)?.[1]?.trim() || "未命名技能";
}

async function updateIndex(date, skill) {
  const file = path.join(root, "index.md");
  const marker = "| --- | --- | --- |";
  const existing = await readFile(file, "utf8");
  const row = `| ${date} | ${skill.replaceAll("|", "\\|")} | [查看](daily/${date}.md) |`;
  const filtered = existing.split("\n").filter((line) => !line.startsWith(`| ${date} |`));
  const markerIndex = filtered.indexOf(marker);
  filtered.splice(markerIndex + 1, 0, row);
  await writeFile(file, `${filtered.join("\n").replace(/\n*$/, "")}\n`);
}

const date = reportDate();
const dailyDir = path.join(root, "daily");
const output = path.join(dailyDir, `${date}.md`);
await mkdir(dailyDir, { recursive: true });

try {
  await access(output);
  if (!force) {
    console.log(`报告已存在：daily/${date}.md（使用 --force 可重新生成）`);
    process.exit(0);
  }
} catch {
  // File does not exist; continue.
}

const signals = await collectSignals(date);
const report = await generateWithOpenAI(buildPrompt(date, signals));
if (!report.includes("# Daily Skill Report")) throw new Error("生成内容未符合日报结构，未写入文件。");
await writeFile(output, report);
await updateIndex(date, skillFromReport(report));
console.log(`已生成 daily/${date}.md，使用 ${signals.length} 条趋势信号。`);
