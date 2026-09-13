import pp from "puppeteer-core";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL = process.env.VERIFY_URL || "http://127.0.0.1:5211/?demo=0";
const b = await pp.launch({ executablePath: CHROME, headless: "new", protocolTimeout: 600000, args: ["--no-sandbox", "--disable-gpu"], defaultViewport: { width: 1700, height: 1100 } });
const p = await b.newPage();
await p.goto(URL, { waitUntil: "networkidle2", timeout: 90000 });
await new Promise((r) => setTimeout(r, 7000));

const probe = async (label) => {
  const info = await p.evaluate(() => {
    const containers = [...document.querySelectorAll(".pages-container")];
    const pages = [...document.querySelectorAll(".pages-container .page")];
    const cs = getComputedStyle(document.documentElement);
    return {
      varW: cs.getPropertyValue("--ravtext-page-width").trim(),
      varH: cs.getPropertyValue("--ravtext-page-height").trim(),
      containers: containers.map((c) => ({
        cls: c.className.slice(0, 40),
        display: getComputedStyle(c).display,
        w: Math.round(c.getBoundingClientRect().width),
        pages: c.querySelectorAll(".page").length,
      })),
      pages: pages.slice(0, 3).map((pg) => {
        const r = pg.getBoundingClientRect();
        const cs2 = getComputedStyle(pg);
        return {
          w: Math.round(r.width), h: Math.round(r.height),
          cssW: cs2.width, cssH: cs2.height,
          display: cs2.display, cv: cs2.contentVisibility,
          realized: pg.dataset.realized, offsetParent: !!pg.offsetParent,
        };
      }),
    };
  });
  console.log(label, JSON.stringify(info, null, 1));
};

await probe("A4 (ברירת מחדל):");
await p.evaluate(() => {
  const sel = document.getElementById("page-size-select");
  sel.value = "a5l";
  sel.dispatchEvent(new Event("change", { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 8000));
await probe("A5 לרוחב:");
await b.close();
