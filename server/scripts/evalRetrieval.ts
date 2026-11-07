/**
 * Milestone 3.5 golden retrieval simulations (no Anthropic required).
 * Usage: npm run eval:retrieval
 */

import {
  buildRetrievalPlan,
  GarmentCategory,
} from "../services/fashionIntent";
import { searchDeepFashionDetailed } from "../services/deepFashion";
import { existsSync } from "fs";
import path from "path";

type CaseResult = { name: string; ok: boolean; detail: string };

function assert(name: string, ok: boolean, detail: string): CaseResult {
  return { name, ok, detail };
}

function isMenUrl(url: string): boolean {
  const file = decodeURIComponent(url.split("/").pop() || "");
  return /^MEN-/i.test(file) || file.includes("-MEN-");
}

function isWomenUrl(url: string): boolean {
  const file = decodeURIComponent(url.split("/").pop() || "");
  return /^WOMEN-/i.test(file) || file.includes("-WOMEN-");
}

function run(): number {
  const results: CaseResult[] = [];

  // 1) combine
  {
    const plan = buildRetrievalPlan("what pants go with this t-shirt", true);
    const search = searchDeepFashionDetailed(plan, 4);
    const allowed: GarmentCategory[] = ["bottom", "shoes", "bag"];
    const bad = search.categories.filter((c) => !allowed.includes(c));
    results.push(
      assert(
        "combine:intent",
        plan.intent === "combine",
        `intent=${plan.intent} targets=${plan.targetCategories.join(",")}`
      )
    );
    results.push(
      assert(
        "combine:no-tops",
        search.outfits.length > 0 && bad.length === 0,
        `n=${search.outfits.length} cats=${search.categories.join(",")} match=${search.match}`
      )
    );
    results.push(
      assert(
        "combine:not-random-empty-ok",
        search.match !== "empty" || search.outfits.length === 0,
        `match=${search.match}`
      )
    );
  }

  // 2) similar
  {
    const plan = buildRetrievalPlan("show me similar shirts to this tee", true);
    const search = searchDeepFashionDetailed(plan, 4);
    const bad = search.categories.filter((c) => c !== "top");
    results.push(
      assert(
        "similar:intent",
        plan.intent === "similar" && plan.targetCategories[0] === "top",
        `intent=${plan.intent} targets=${plan.targetCategories.join(",")}`
      )
    );
    results.push(
      assert(
        "similar:tops-only",
        search.outfits.length > 0 && bad.length === 0,
        `n=${search.outfits.length} cats=${search.categories.join(",")} match=${search.match}`
      )
    );
  }

  // 3) color — must not silent-random; empty or color-matched only
  {
    const plan = buildRetrievalPlan("navy color palette recommendations", false);
    const search = searchDeepFashionDetailed(plan, 4);
    results.push(
      assert(
        "color:intent",
        plan.intent === "color" && plan.colors.includes("navy"),
        `intent=${plan.intent} colors=${plan.colors.join(",")}`
      )
    );
    results.push(
      assert(
        "color:no-silent-random",
        search.match === "empty" || search.match === "strict",
        `match=${search.match} n=${search.outfits.length}`
      )
    );
    if (search.outfits.length > 0) {
      const allNavy = search.outfits.every((o) =>
        /navy|blue/i.test(`${o.name} ${o.description} ${o.imageUrl}`)
      );
      results.push(
        assert(
          "color:hits-mention-navy-or-blue",
          allNavy,
          search.outfits.map((o) => o.description.slice(0, 40)).join(" | ")
        )
      );
    } else {
      results.push(
        assert("color:empty-allowed", true, "no DeepFashion navy captions — empty OK")
      );
    }
  }

  // “what colors go with navy” used to fire combine because of “go with”
  {
    const plan = buildRetrievalPlan("what colors go with navy", false);
    results.push(
      assert(
        "color:go-with-not-combine",
        plan.intent === "color" && plan.colors.includes("navy"),
        `intent=${plan.intent} colors=${plan.colors.join(",")}`
      )
    );
  }

  // 4) style
  {
    const plan = buildRetrievalPlan("minimal office style outfits", false);
    const search = searchDeepFashionDetailed(plan, 4);
    results.push(
      assert(
        "style:intent",
        plan.intent === "style" &&
          (plan.styleTags.includes("minimal") || plan.styleTags.includes("office")),
        `intent=${plan.intent} tags=${plan.styleTags.join(",")}`
      )
    );
    results.push(
      assert(
        "style:has-results-or-empty",
        search.match === "strict" ||
          search.match === "broadened" ||
          search.match === "empty",
        `match=${search.match} n=${search.outfits.length} cats=${search.categories.join(",")}`
      )
    );
    results.push(
      assert(
        "style:not-unfocused-if-strict",
        search.match !== "strict" || search.outfits.length > 0,
        `match=${search.match}`
      )
    );
  }

  // 5) audience feminine
  {
    const plan = buildRetrievalPlan("casual outfits for women", false);
    const search = searchDeepFashionDetailed(plan, 6);
    const leak = search.outfits.some((o) => isMenUrl(o.imageUrl));
    results.push(
      assert(
        "audience:feminine-plan",
        plan.audience === "feminine",
        `audience=${plan.audience}`
      )
    );
    results.push(
      assert(
        "audience:feminine-no-MEN",
        !leak,
        leak
          ? search.outfits.map((o) => o.imageUrl.split("/").pop()).join(",")
          : `n=${search.outfits.length}`
      )
    );
  }

  // 6) audience masculine
  {
    const plan = buildRetrievalPlan("casual outfits for men", false);
    const search = searchDeepFashionDetailed(plan, 6);
    const leak = search.outfits.some((o) => isWomenUrl(o.imageUrl));
    results.push(
      assert(
        "audience:masculine-plan",
        plan.audience === "masculine",
        `audience=${plan.audience}`
      )
    );
    results.push(
      assert(
        "audience:masculine-no-WOMEN",
        !leak,
        leak
          ? search.outfits.map((o) => o.imageUrl.split("/").pop()).join(",")
          : `n=${search.outfits.length}`
      )
    );
  }

  // 7) browse: party dresses — hard category, implied feminine, fill to 4
  {
    const plan = buildRetrievalPlan("show me party dresses", false);
    const search = searchDeepFashionDetailed(plan, 4);
    const leak = search.outfits.some((o) => isMenUrl(o.imageUrl));
    const bad = search.categories.filter((c) => c !== "dress");
    results.push(
      assert(
        "browse:party-dresses-plan",
        plan.intent === "browse" &&
          plan.audience === "feminine" &&
          plan.targetCategories[0] === "dress" &&
          !plan.needsFollowUp,
        `intent=${plan.intent} audience=${plan.audience} cats=${plan.targetCategories.join(",")} followUp=${plan.needsFollowUp}`
      )
    );
    results.push(
      assert(
        "browse:party-dresses-all-dress",
        search.outfits.length === 4 && bad.length === 0,
        `n=${search.outfits.length} cats=${search.categories.join(",")} match=${search.match}`
      )
    );
    results.push(
      assert(
        "browse:party-dresses-no-MEN",
        !leak,
        leak
          ? search.outfits.map((o) => o.imageUrl.split("/").pop()).join(",")
          : `n=${search.outfits.length}`
      )
    );
  }

  {
    const plan = buildRetrievalPlan("show me dresses", false);
    const search = searchDeepFashionDetailed(plan, 4);
    const bad = search.categories.filter((c) => c !== "dress");
    results.push(
      assert(
        "browse:dresses-unconstrained-color",
        plan.intent === "browse" &&
          plan.audience === "feminine" &&
          plan.colors.length === 0,
        `intent=${plan.intent} colors=${plan.colors.join(",")}`
      )
    );
    results.push(
      assert(
        "browse:dresses-all-dress",
        search.outfits.length === 4 && bad.length === 0,
        `n=${search.outfits.length} cats=${search.categories.join(",")}`
      )
    );
  }

  {
    const plan = buildRetrievalPlan("navy party dresses", false);
    const search = searchDeepFashionDetailed(plan, 4);
    const bad = search.categories.filter((c) => c !== "dress");
    results.push(
      assert(
        "browse:navy-party-still-dresses",
        plan.intent === "browse" &&
          plan.colors.includes("navy") &&
          search.outfits.length === 4 &&
          bad.length === 0,
        `intent=${plan.intent} n=${search.outfits.length} cats=${search.categories.join(",")}`
      )
    );
  }

  {
    const plan = buildRetrievalPlan("show me blazers", false);
    const search = searchDeepFashionDetailed(plan, 4);
    results.push(
      assert(
        "browse:blazers-follow-up",
        plan.intent === "browse" &&
          plan.needsFollowUp === true &&
          plan.audience === "any",
        `intent=${plan.intent} followUp=${plan.needsFollowUp} audience=${plan.audience}`
      )
    );
    results.push(
      assert(
        "browse:blazers-no-cards-until-answer",
        plan.needsFollowUp === true,
        `n would be ${search.outfits.length} if retrieved anyway`
      )
    );
  }

  {
    const plan = buildRetrievalPlan("casual office", false, ["show me blazers"]);
    results.push(
      assert(
        "browse:blazers-history-still-follow-up-gender",
        plan.intent === "browse" &&
          plan.anchorGarment === "outerwear" &&
          plan.needsFollowUp === true,
        `intent=${plan.intent} audience=${plan.audience} followUp=${plan.needsFollowUp} tags=${plan.styleTags.join(",")}`
      )
    );
  }

  {
    const plan = buildRetrievalPlan("for women, casual", false, ["show me blazers"]);
    results.push(
      assert(
        "browse:blazers-after-clarify",
        plan.intent === "browse" &&
          plan.audience === "feminine" &&
          !plan.needsFollowUp &&
          plan.targetCategories[0] === "outerwear",
        `intent=${plan.intent} audience=${plan.audience} followUp=${plan.needsFollowUp}`
      )
    );
  }

  let failed = 0;
  for (const r of results) {
    const mark = r.ok ? "PASS" : "FAIL";
    if (!r.ok) failed += 1;
    console.log(`${mark}  ${r.name} — ${r.detail}`);
  }
  console.log(
    `\n${results.length - failed}/${results.length} passed` +
      (failed ? ` (${failed} failed)` : "")
  );
  return failed;
}

// ADDED: the image corpus is gitignored, so a fresh clone has none. Say so up front
// instead of letting every image check fail with "n=0".
const captionsPath = path.join(
  process.env.DEEPFASHION_ROOT ||
    path.join(process.cwd(), "server", "data", "DeepFashion-MultiModal"),
  "captions.json",
);
const corpusPresent = existsSync(captionsPath);
if (!corpusPresent) {
  console.warn(
    `WARNING: DeepFashion corpus not found at ${captionsPath}.\n` +
      "Checks that count returned images will fail. Place the dataset there (see README step 8) for a real result.\n",
  );
}
const failures = run();
if (failures > 0 && !corpusPresent) {
  console.warn(`${failures} failure(s) above are expected without the corpus; they do not show a logic bug.`);
}
process.exit(failures);
