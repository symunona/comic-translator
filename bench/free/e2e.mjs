// node bench/free/e2e.mjs <cdp> <app-url> <remote-image-path> <lang> <shot.png>
import { chromium } from "playwright-core";
const [cdp, app, img, lang, shot, gpu] = process.argv.slice(2);
const b = await chromium.connectOverCDP(cdp);
const p = await b.contexts()[0].newPage();
await p.setViewportSize({ width: 1400, height: 1000 });
p.on("console", (m) => m.type() === "error" && console.error("page:", m.text().slice(0, 200)));
await p.goto(app);
await p.evaluate(() => localStorage.clear());
await p.goto(app);
const [chooser] = await Promise.all([p.waitForEvent("filechooser"), p.evaluate(() => document.querySelector('input[type=file]').click())]);
await chooser.setFiles(img);
await p.waitForURL(/\/s\//);
await p.goto(p.url().replace(/lang=[^&]*/, `lang=${lang}`));
const steps = () => p.$$eval(".checklist li", (ls) => ls.map((l) => l.className.replace("step ", "") + ": " + l.textContent.replace(/\s+/g, " ").trim()).join("\n"));
await p.waitForSelector(".free-box button", { timeout: 120000 });
console.log("modal:", await p.$eval(".free-box", (e) => e.textContent.replace(/\s+/g, " ")));
if (gpu) await p.check(".free-box input[type=checkbox]");
await p.click(".free-box button");
const t0 = Date.now();
let clicks = 1;
for (;;) {
  await p.waitForTimeout(3000);
  const done = await p.evaluate(() => !!document.querySelector(".card textarea") && ![...document.querySelectorAll(".checklist li")].some((l) => l.classList.contains("running")));
  if (done || Date.now() - t0 > 1200000) break;
  if (await p.$(".free-box button")) {
    console.log("modal again:", await p.$eval(".key-dialog .fatal", (e) => e.textContent).catch(() => "?"));
    if (clicks++ > 3) break;
    await p.click(".free-box button");
  }
}
console.log(await steps());
if (await p.$(".free-box")) console.log("modal again:", await p.$eval(".key-dialog .fatal", (e) => e.textContent).catch(() => "?"));
const cards = await p.$$eval(".card", (cs) => cs.slice(0, 8).map((c) => c.textContent.replace(/\s+/g, " ").slice(0, 160)));
console.log(cards.join("\n"));
await p.screenshot({ path: shot, fullPage: false });
console.log("seconds", (Date.now() - t0) / 1000);
await p.close();
await b.close();
