// node bench/free/run.mjs <cdp-url> <page-url> <out.json>
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const [cdp, url, out] = process.argv.slice(2);
const b = await chromium.connectOverCDP(cdp);
const p = await b.contexts()[0].newPage();
p.on("console", (m) => m.type() === "error" && console.error("page:", m.text()));
await p.goto(url);
await p.click("#go");
const t0 = Date.now();
const tick = setInterval(async () => {
  const log = await p.evaluate(() => document.getElementById("log").textContent.trim().split("\n").at(-1)).catch(() => "");
  console.log(`${((Date.now() - t0) / 1000).toFixed(0)} s · ${log}`);
}, 15000);
await p.waitForFunction(() => window.__result || window.__error, null, { timeout: 3_600_000 });
clearInterval(tick);
const err = await p.evaluate(() => window.__error);
if (err) throw new Error(err);
const result = await p.evaluate(() => window.__result);
const meta = await p.evaluate(() => ({ ua: navigator.userAgent, isolated: crossOriginIsolated }));
await writeFile(out, JSON.stringify({ meta, at: new Date().toISOString(), result }, null, 1));
console.log("wrote", out);
await p.close();
await b.close();
