import { createHash } from "node:crypto";

export function clean(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

export function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function reportDate(timezone = "Asia/Shanghai") {
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

export function daysAgo(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function formatNumber(value) {
  if (value === null || value === undefined) return "待积累";
  return new Intl.NumberFormat("zh-CN").format(value);
}

export function relativeTimeLabel(iso, date) {
  if (!iso) return "未知";
  const diff = Math.max(
    0,
    Math.floor((new Date(`${date}T23:59:59Z`) - new Date(iso)) / 86_400_000),
  );
  if (diff === 0) return "今天";
  if (diff === 1) return "1 天前";
  return `${diff} 天前`;
}

export async function fetchJson(url, options = {}, retries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(30_000),
        headers: {
          "User-Agent": "agent-skill-daily/2.0",
          Accept: "application/vnd.github+json",
          ...options.headers,
        },
      });
      const text = await response.text();
      const payload = text ? JSON.parse(text) : {};
      if (response.ok) return payload;
      const error = new Error(
        `${response.status} ${response.statusText}: ${payload.message || text || "请求失败"}`,
      );
      error.status = response.status;
      if (![429, 500, 502, 503, 504].includes(response.status)) throw error;
      lastError = error;
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 800 * 2 ** attempt));
  }
  throw lastError;
}

export function githubHeaders() {
  const token = process.env.GITHUB_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}
