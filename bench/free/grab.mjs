// node bench/free/grab.mjs <cdp> <url-substring> <out.json>: wait on an already open bench page
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";
const [cdp, sub, out] = process.argv.slice(2);
const b = await chromium.connectOverCDP(cdp);
const p = b.contexts()[0].pages().find((x) => x.url().includes(sub));
await p.waitForFunction(() => window.__result || window.__error, null, { timeout: 0, polling: 10000 });
const err = await p.evaluate(() => window.__error);
if (err) throw new Error(err);
await writeFile(out, JSON.stringify({ at: new Date().toISOString(), result: await p.evaluate(() => window.__result) }, null, 1));
console.log("wrote", out);
await b.close().catch(() => {});
