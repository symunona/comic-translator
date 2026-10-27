// node bench/free/warm.mjs <cdp> <url> hu-en en-hu ...: one click per Chrome Translator pack
import { chromium } from "playwright-core";
const [cdp, url, ...pairs] = process.argv.slice(2);
const b = await chromium.connectOverCDP(cdp);
const p = await b.contexts()[0].newPage();
await p.goto(url);
for (const pair of pairs) {
  const [s, t] = pair.split("-");
  await p.evaluate(([s, t]) => {
    const btn = Object.assign(document.createElement("button"), { id: "warm", textContent: "warm" });
    btn.style.cssText = "position:fixed;inset:0;z-index:99999";
    window.__warm = null;
    btn.onclick = () => Translator.create({ sourceLanguage: s, targetLanguage: t }).then((x) => x.translate("teszt")).then((r) => (window.__warm = r), (e) => (window.__warm = String(e)));
    document.body.replaceChildren(btn);
  }, [s, t]);
  await p.click("#warm");
  await p.waitForFunction(() => window.__warm, null, { timeout: 300000 });
  console.log(pair, await p.evaluate(() => window.__warm));
}
await p.close();
await b.close();
