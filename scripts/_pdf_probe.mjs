// probe: למה כפתור ה-PDF לא מוריד קובץ
import pp from "puppeteer-core";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL = process.env.VERIFY_URL || "http://127.0.0.1:5211/?demo=0";
const b = await pp.launch({ executablePath: CHROME, headless: "new", protocolTimeout: 600000, args: ["--no-sandbox", "--disable-gpu"], defaultViewport: { width: 1600, height: 1000 } });
const p = await b.newPage();
const logs = [];
p.on("console", (m) => logs.push(`${m.type()}: ${m.text().slice(0, 200)}`));
p.on("pageerror", (e) => logs.push("pageerror: " + e.message.slice(0, 200)));
p.on("dialog", async (d) => { logs.push("DIALOG: " + d.message().slice(0, 300)); await d.dismiss(); });
await p.goto(URL, { waitUntil: "networkidle2", timeout: 90000 });
await p.evaluate(() => {
  localStorage.setItem("ravtext.vilnaDaf.enabled", "auto");
  localStorage.setItem("ravtext.talmudLayout", "1");
  localStorage.setItem("ravtext.talmudLayout.streams", "01");
});
await p.reload({ waitUntil: "networkidle2", timeout: 90000 });
if (process.env.SKIP_IMPORT === "1") {
  await new Promise((r) => setTimeout(r, 8000));
} else {
await p.waitForSelector("#btn-vilna-import", { timeout: 30000 });
await p.$eval("#btn-vilna-import", (el) => el.click());
await p.waitForSelector("#vilna-import-tractate", { timeout: 30000 });
await new Promise((r) => setTimeout(r, 1200));
await p.evaluate(() => {
  const s = document.querySelector("#vilna-import-tractate");
  s.value = "berakhot"; s.dispatchEvent(new Event("change", { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 2000));
await p.evaluate(() => {
  const modal = document.querySelector(".sef-modal");
  const selects = modal.querySelectorAll("select");
  const fire = (el, ev = "change") => el.dispatchEvent(new Event(ev, { bubbles: true }));
  selects[1].value = "dafim"; fire(selects[1]);
  const t = [...modal.querySelectorAll("input")].filter((i) => i.type !== "checkbox");
  t[0].value = "ב."; fire(t[0], "input");
  t[1].value = "ב:"; fire(t[1], "input");
});
await new Promise((r) => setTimeout(r, 400));
await p.evaluate(() => [...document.querySelectorAll(".sef-modal button")].find((x) => x.textContent.includes("ייבא לעורך")).click());
}
const dl = Date.now() + 300000;
while (Date.now() < dl) {
  const ok = await p.evaluate(() => document.querySelectorAll(".pages-container .page").length > 0 && !!window.__VILNA_DAF_REPORT__);
  if (ok) break;
  await new Promise((r) => setTimeout(r, 1000));
}
await new Promise((r) => setTimeout(r, 1500));

const info = await p.evaluate(() => {
  const btn = document.getElementById("pdf-download");
  return {
    exists: !!btn,
    disabled: btn?.disabled,
    hidden: btn ? (btn.offsetParent === null) : null,
    text: btn?.textContent?.trim(),
    demoMode: window.__RAVTEXT_DEMO_MODE__,
    storageDisabled: window.__RAVTEXT_STORAGE_DISABLED__,
    auth: window.__RAVTEXT_AUTH__ ? { paid: window.__RAVTEXT_AUTH__.paid, admin: window.__RAVTEXT_AUTH__.admin } : null,
    pages: document.querySelectorAll(".pages-container .page").length,
  };
});
console.log("BUTTON:", JSON.stringify(info));
logs.length = 0;
await p.evaluate(() => document.getElementById("pdf-download")?.click());
await new Promise((r) => setTimeout(r, 20000));
const after = await p.evaluate(() => ({
  text: document.getElementById("pdf-download")?.textContent?.trim(),
  disabled: document.getElementById("pdf-download")?.disabled,
}));
console.log("AFTER CLICK:", JSON.stringify(after));
console.log("LOGS:");
for (const l of logs.slice(0, 25)) console.log("   ", l);
await b.close();
