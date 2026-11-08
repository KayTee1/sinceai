import { chromium } from "playwright";
import { newRecordedPage } from "./recorder.mjs";
const URL0 = "http://localhost:3100/";
const only = process.argv[2]; // optional: run one scene
const b = await chromium.launch({ channel: "chrome", headless: true });

async function open(dir) {
  const r = await newRecordedPage(b, dir);
  const p = r.page;
  const btn = (re) => p.locator("button").filter({ hasText: re }).first();
  const idle = async () => {
    await p.waitForTimeout(900);
    await btn(/^Stop$/).waitFor({ state: "detached", timeout: 240000 }).catch(() => {});
    await p.waitForTimeout(800);
  };
  await p.goto(URL0); await btn(/^Manager$/).click(); await p.waitForTimeout(600);
  return { ...r, p, btn, idle };
}
const wheel = async (p, dy, steps = 12, gap = 60) => { for (let i = 0; i < steps; i++) { await p.mouse.wheel(0, dy / steps); await p.waitForTimeout(gap); } };

const SCENES = {
  // Day one: estate scan + a merge suggestion
  async A() {
    const s = await open("A");
    await s.click(s.btn(/Estate overview/)); await s.p.waitForTimeout(500);
    await s.start(); s.mark("overview");
    await s.p.mouse.move(960, 600, { steps: 10 }); await s.p.waitForTimeout(3500);
    await s.moveTo(s.p.getByText("Duplicated scopes", { exact: true })); await s.p.waitForTimeout(1800);
    await wheel(s.p, 520, 16, 70); s.mark("scrolled to duplicates + KPI variants"); await s.p.waitForTimeout(3500);
    await s.click(s.btn(/^Agentic$/)); await s.p.waitForTimeout(900); s.mark("agentic");
    const box = s.p.locator("textarea").first();
    await s.click(box); await box.pressSequentially("Which dashboards could AST-0007 be merged with?", { delay: 35 });
    await s.p.waitForTimeout(400); s.mark("send merge question");
    await s.click(s.btn(/^Send$/)); await s.idle(); s.mark("merge answer");
    await s.p.waitForTimeout(1500);
    const card = s.p.getByText("Merge suggested").first();
    if (await card.count()) { await card.scrollIntoViewIfNeeded(); await s.moveTo(card); s.mark("merge card"); }
    await s.p.waitForTimeout(4000);
    await s.stop();
  },
  // Rules 1 + 2: request, pipeline, submit, approve
  async B() {
    const s = await open("B");
    await s.click(s.btn(/^Agentic$/)); await s.p.waitForTimeout(500);
    await s.start(); s.mark("empty chat"); await s.p.waitForTimeout(1500);
    await s.click(s.btn(/Run team demo request TEAM-REQ-01/)); s.mark("request sent");
    await s.idle(); s.mark("analysis done"); await s.p.waitForTimeout(3000);
    const steps = s.p.getByText("Compare definitions").first();
    if (await steps.count()) { await s.moveTo(steps); await s.p.waitForTimeout(2500); }
    s.mark("pipeline shown");
    await s.click(s.btn(/Submit build proposal/)); s.mark("submit"); await s.idle(); s.mark("submitted");
    await s.p.waitForTimeout(1500);
    await s.click(s.btn(/^Inbox/)); s.mark("inbox"); await s.p.waitForTimeout(2500);
    await s.moveTo(s.p.getByText("Decide as:").first()); await s.p.waitForTimeout(1500);
    await s.click(s.p.locator("button").filter({ hasText: /^Approve$/ }).first()); s.mark("approved");
    await s.p.waitForTimeout(2500);
    const openBtn = s.btn(/Open INS-TEAM-REQ-01-1/);
    if (await openBtn.count()) { await openBtn.scrollIntoViewIfNeeded(); await s.moveTo(openBtn); s.mark("outcome card"); }
    await s.p.waitForTimeout(3500);
    await s.stop();
  },
  // Rule 3: provenance of a number, semantic model of a catalog dashboard
  async C() {
    const s = await open("C");
    await s.click(s.btn(/Analytics catalog/)); await s.p.waitForTimeout(400);
    await s.p.locator("input").first().fill("INS-TEAM-REQ-01"); await s.p.waitForTimeout(400);
    await s.p.locator("aside li button").first().click(); await s.p.waitForTimeout(1000);
    await s.start(); s.mark("insight"); await s.p.waitForTimeout(2500);
    const v = s.p.locator("section button").filter({ hasText: /€/ }).first();
    await s.click(v); s.mark("value clicked"); await s.p.waitForTimeout(1500);
    const how = s.p.getByText(/How .* was computed/).first();
    await how.scrollIntoViewIfNeeded(); await s.moveTo(how); await s.p.waitForTimeout(1200);
    await wheel(s.p, 380, 12, 70); s.mark("SQL visible"); await s.p.waitForTimeout(4000);
    const search = s.p.locator("input").first();
    await s.click(search); await search.fill(""); await search.pressSequentially("AST-0201", { delay: 45 });
    await s.p.waitForTimeout(500);
    await s.click(s.p.locator("aside li button").first()); s.mark("AST-0201"); await s.p.waitForTimeout(1500);
    await s.moveTo(s.p.getByText("Semantic model", { exact: true }).first()); s.mark("semantic model"); await s.p.waitForTimeout(3500);
    await s.moveTo(s.p.getByText(/inactive/).first()); s.mark("owner inactive"); await s.p.waitForTimeout(2500);
    await s.stop();
  },
  // Rule 4 + autopilot: owner left -> steward; +30d; scheduler
  async D() {
    const s = await open("D");
    await s.click(s.btn(/^Agentic$/)); await s.p.waitForTimeout(300);
    await s.click(s.btn(/^Inbox/)); await s.p.waitForTimeout(800);
    await s.start(); s.mark("inbox empty"); await s.p.waitForTimeout(1500);
    await s.click(s.btn(/Next event/)); s.mark("next event"); await s.p.waitForTimeout(3000);
    const steward = s.p.getByText(/waits for the steward/).first();
    if (await steward.count()) { await s.moveTo(steward); s.mark("waits for steward"); }
    await s.p.waitForTimeout(4000);
    await s.click(s.btn(/^\+30d$/)); s.mark("+30d"); await s.p.waitForTimeout(6000);
    await s.moveTo(s.p.getByText(/Escalated/).first()); s.mark("escalated count"); await s.p.waitForTimeout(2500);
    await s.click(s.btn(/^Scheduler$/)); s.mark("scheduler"); await s.p.waitForTimeout(2500);
    const run = s.btn(/^Run now$/);
    if (await run.count()) { await s.click(run); s.mark("run now"); await s.p.waitForTimeout(4000); }
    const f = s.btn(/^Findings/);
    if (await f.count()) { await s.click(f); s.mark("findings"); await s.p.waitForTimeout(4000); }
    await s.click(s.btn(/^Dashboard$/)); await s.click(s.btn(/Estate overview/)); s.mark("overview after");
    await s.p.waitForTimeout(1200);
    await s.moveTo(s.p.getByText(/APPLIED CHANGES|Applied changes/).first()); s.mark("applied changes"); await s.p.waitForTimeout(4500);
    await s.stop();
  },
};

if (!only || only === "reset") { const r = await fetch(URL0 + "api/lifecycle/reset", { method: "POST" }); console.log("reset", r.status); }
for (const k of Object.keys(SCENES)) {
  if (only && only !== "reset" && only !== k) continue;
  console.log("scene", k); const t = Date.now();
  await SCENES[k](); console.log(`scene ${k} done in ${((Date.now() - t) / 1000).toFixed(0)}s`);
}
await b.close();
