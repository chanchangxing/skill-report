import { readFile } from "node:fs/promises";
import path from "node:path";
import { renderSite } from "./lib/render.mjs";

const root = process.cwd();
const history = JSON.parse(await readFile(path.join(root, "data", "history.json"), "utf8"));
await renderSite({ root, reports: history });
console.log(`已根据 ${history.length} 条历史记录生成站点。`);
