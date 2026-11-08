// Records a page as sharp JPEG frames via CDP screencast, with a visible cursor.
import fs from "node:fs";
const CURSOR = `
  addEventListener("DOMContentLoaded", () => {
    const c = document.createElement("div");
    c.id = "__cur";
    Object.assign(c.style, { position: "fixed", left: "-50px", top: "-50px", width: "22px", height: "22px",
      marginLeft: "-11px", marginTop: "-11px", borderRadius: "50%", background: "rgba(0,145,223,.35)",
      border: "2px solid rgba(0,145,223,.9)", zIndex: 2147483647, pointerEvents: "none",
      transition: "transform .12s ease" });
    document.body.appendChild(c);
    addEventListener("mousemove", (e) => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }, true);
    addEventListener("mousedown", () => (c.style.transform = "scale(.7)"), true);
    addEventListener("mouseup", () => (c.style.transform = "scale(1)"), true);
  });`;
export async function newRecordedPage(browser, dir) {
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(CURSOR);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const frames = []; let n = 0; let t0 = null; const marks = [];
  cdp.on("Page.screencastFrame", async (f) => {
    const ts = f.metadata.timestamp; if (t0 === null) t0 = ts;
    const file = `${dir}/f${String(n++).padStart(6, "0")}.jpg`;
    fs.writeFileSync(file, Buffer.from(f.data, "base64"));
    frames.push({ file, t: ts - t0 });
    await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  const start = async () => cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  const mark = (label) => { const t = frames.length ? frames[frames.length - 1].t : 0; marks.push({ label, t: +t.toFixed(2) }); console.log(`  [${t.toFixed(1)}s] ${label}`); };
  const stop = async () => {
    await page.waitForTimeout(500);
    await cdp.send("Page.stopScreencast").catch(() => {});
    // ffconcat: each frame lasts until the next one
    let s = "ffconcat version 1.0\n";
    for (let i = 0; i < frames.length; i++) {
      const d = i + 1 < frames.length ? frames[i + 1].t - frames[i].t : 1.0;
      s += `file '${frames[i].file.split("/").pop()}'\nduration ${Math.max(d, 0.001).toFixed(4)}\n`;
    }
    s += `file '${frames[frames.length - 1].file.split("/").pop()}'\n`;
    fs.writeFileSync(`${dir}/list.ffconcat`, s);
    fs.writeFileSync(`${dir}/marks.json`, JSON.stringify(marks, null, 1));
    await ctx.close();
  };
  // human-like helpers
  const moveTo = async (loc) => {
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    const b = await loc.boundingBox(); if (!b) return;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 18 });
  };
  const click = async (loc, pause = 350) => { await moveTo(loc); await page.waitForTimeout(pause); await loc.click(); };
  return { page, start, stop, mark, moveTo, click };
}
