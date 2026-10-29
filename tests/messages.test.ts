import test from "node:test";
import assert from "node:assert/strict";
import { checkDraft, display, factsDigest, template, type MessageFacts } from "../src/messages.ts";

const F: MessageFacts = { kind: "offer", to: { kind: "buyer", id: "buyer-b", name: "Riverbend School Kitchen" }, product: "tomato", substitute: "zucchini", amount: 30, unit: "lb", deliveryOn: "2026-10-30" };
const P = ["tomato", "cucumber", "zucchini"];
const OFFER = "Could you take 30 lb of zucchini instead of tomatoes on Friday?";

test("templates pass their own check", () => {
  for (const kind of ["request", "offer", "notice"] as const) {
    const f = { ...F, kind };
    assert.deepEqual(checkDraft(template(f), f, P), { ok: true, problems: [], confirm: [] }, kind);
  }
});

test("display and template copy", () => {
  assert.equal(display(30000, "g"), "30 kg");
  assert.equal(display(15500, "g"), "15.5 kg");
  assert.equal(display(12, "each"), "12 each");
  assert.equal(template(F), "Hi Riverbend School Kitchen, we're 30 lb short on tomato for Friday. Would zucchini work for that 30 lb? Reply yes or no.");
});

test("accepts faithful rewordings", () => {
  assert.ok(checkDraft(OFFER, F, P).ok);
  assert.ok(checkDraft(OFFER.replace("30 lb", "30lbs"), F, P).ok);
  assert.ok(checkDraft("Can you do 15kg of tomatoes by Friday?", { ...F, kind: "request", amount: 15000, unit: "g" }, P).ok);
  assert.ok(checkDraft("Can you do 15.5 kg of tomatoes by Friday?", { ...F, kind: "request", amount: 15500, unit: "g" }, P).ok);
});

test("rejects drift and names the offending text", () => {
  const bad: [string, RegExp][] = [
    [OFFER.replace("30 lb", "40 lb"), /40 lb/],
    [OFFER.replace("30 lb", "30 kg"), /30 kg/],
    [OFFER.replace("Friday", "Thursday"), /Thursday/],
    [OFFER + " Cucumbers too?", /cucumber/],
    ["Could you take zucchini instead of tomatoes on Friday?", /amount/],
    [OFFER.replace("30 lb", "forty pounds"), /forty pounds/],
    [OFFER + " Maybe 2 cases.", /2/],
    [OFFER + " Or October 29.", /October 29/],
    [OFFER + " x".repeat(240), /480/],
    ["", /empty/],
  ];
  for (const [text, re] of bad) {
    const c = checkDraft(text, F, P);
    assert.equal(c.ok, false, text);
    assert.ok(c.problems.some(p => re.test(p)), `${text} -> ${c.problems}`);
  }
  assert.deepEqual(checkDraft("", F, P).problems, ["Message is empty"]);
  // Task 14: a number in words is read as its value, so the decision's own amount passes.
  assert.deepEqual(checkDraft(OFFER.replace("30 lb", "thirty pounds"), F, P), { ok: true, problems: [], confirm: [] });
});

test("factsDigest is key-order independent and tracks amount", () => {
  const { kind, to, product, substitute, amount, unit, deliveryOn } = F;
  const reordered = { deliveryOn, unit, amount, substitute, product, to: { name: to.name, id: to.id, kind: to.kind }, kind } as MessageFacts;
  assert.equal(factsDigest(F), factsDigest(reordered));
  assert.notEqual(factsDigest(F), factsDigest({ ...F, amount: 31 }));
});

// Fix round 1 regressions.
test("template passes its own check across gram amounts", () => {
  for (let g = 1; g <= 20000; g++) {
    const f = { ...F, kind: "notice" as const, amount: g, unit: "g" as const };
    assert.ok(checkDraft(template(f), f, P).ok, `${g} g: ${checkDraft(template(f), f, P).problems}`);
  }
  const e = { ...F, kind: "request" as const, amount: 12, unit: "each" as const };
  assert.ok(checkDraft(template(e), e, P).ok);
});

test("recipient names are not checked as prose", () => {
  for (const name of ["Three Sisters Farm", "Farm 12", "Tomato Hill Farm", "Zoë's Kitchen"]) {
    for (const kind of ["request", "offer", "notice"] as const) {
      const f = { ...F, kind, to: { ...F.to, name } };
      assert.ok(checkDraft(template(f), f, P).ok, `${kind} ${name}: ${checkDraft(template(f), f, P).problems}`);
    }
  }
});

test("rejects number-word, unit, unicode and decimal bypasses", () => {
  const bad: [string, RegExp][] = [
    [" Also sixty pounds more.", /sixty/],
    [" Plus an extra pound.", /pound/],
    [" And a couple of cases.", /couple|case/],
    [" A few boxes.", /few|box/],
    [" Friday the first of November.", /first/],
    [" That is the thirtieth.", /thirtieth/],
    [" Also ４０ lb", /outside plain text/],
    [" Also ½ lb", /outside plain text/],
    [" Cucumbеr too?", /outside plain text/],
    [" Also .30 lb", /\.30 lb/],
    [" Maybe 30 kgs.", /30 kgs/],
    [" Bring a crate.", /crate/],
    [" Or Mon?", /Mon/],
    [" Or Thursdays?", /Thursdays/],
    [" Or Fri/Sat", /Sat/],
    [" Minicucumbers too?", /cucumber/],
    [" Cucumbers too?", /cucumber/],
  ];
  for (const [add, re] of bad) {
    const c = checkDraft(OFFER + add, F, P);
    assert.equal(c.ok, false, add);
    assert.ok(c.problems.some(p => re.test(p)), `${add} -> ${c.problems}`);
  }
  const bb = { ...F, product: "blueberry", substitute: "zucchini" };
  assert.ok(checkDraft(OFFER.replace("tomatoes", "blueberries"), bb, ["blueberry", "zucchini"]).ok);
  assert.ok(!checkDraft(OFFER + " Blueberries?", F, ["tomato", "zucchini", "blueberry"]).ok);
  assert.ok(checkDraft(OFFER.replace("Friday", "Fri."), F, P).ok);
  assert.ok(checkDraft("30 kgs of zucchini instead of tomatoes on Friday", { ...F, amount: 30000, unit: "g" }, P).ok);
  // Task 14: a relative day is resolved against the writing date, or asked about without one.
  assert.ok(checkDraft(OFFER + " Or tomorrow.", F, P, "2026-10-28").problems.includes(`"tomorrow" means Thursday; the delivery is Friday`));
  assert.deepEqual(checkDraft(OFFER + " Or tomorrow.", F, P).confirm, [{ token: "tomorrow", question: `"tomorrow" — which day is that?` }]);
  // Fix round 3: written Wednesday, no day of next week is Friday 2026-10-30, so it is a problem.
  assert.deepEqual(checkDraft(OFFER + " Or next week.", F, P, "2026-10-28"), { ok: false, problems: [`"next week" does not include the delivery (Friday 2026-10-30)`], confirm: [] });
  assert.ok(checkDraft(OFFER + " Or yesterday.", F, P, "2026-10-29").problems.some(p => /yesterday/.test(p)));
});

test("offer needs a substitute and delivery date must be valid", () => {
  assert.throws(() => template({ ...F, substitute: undefined }), /substitute/);
  assert.throws(() => template({ ...F, deliveryOn: "soon" }), /delivery date/);
  assert.throws(() => checkDraft(OFFER, { ...F, deliveryOn: "2026-13-45" }, P), /delivery date/);
});

test("length boundary is 480", () => {
  const pad = (n: number) => OFFER + " " + "a".repeat(n - OFFER.length - 1);
  assert.equal(pad(480).length, 480);
  assert.ok(checkDraft(pad(480), F, P).ok);
  const c = checkDraft(pad(481), F, P);
  assert.ok(!c.ok && c.problems.some(p => /480/.test(p)));
});

// Fix round 2 regressions.
test("known products match on word boundaries, longest first", () => {
  const K = ["pea", "peach", "tomato", "cherry tomato"];
  const base = { ...F, kind: "request" as const, substitute: undefined, deliveryOn: "2026-10-30" };
  const txt = "Could you bring 30 lb of peach on Friday?";
  assert.ok(checkDraft(txt, { ...base, product: "peach" }, K).ok);
  const c = checkDraft(txt, { ...base, product: "pea" }, K);
  assert.ok(!c.ok && c.problems.some(p => /peach/.test(p)), String(c.problems));
  const t = checkDraft("Could you bring 30 lb of cherry tomatoes on Friday?", { ...base, product: "tomato" }, K);
  assert.ok(!t.ok && t.problems.some(p => /cherry tomato/.test(p)), String(t.problems));
  assert.ok(checkDraft("Could you bring 30 lb of peas on Friday?", { ...base, product: "pea" }, K).ok);
  assert.ok(!checkDraft(OFFER + " Minicucumbers too?", F, P).ok);
});

test("inflected number words and more units", () => {
  const add = [" In twenties.", " A dozen.", " Dozens of them.", " Two ones.", " A quarter.", " A score.", " A gross.", " A ton.", " Pairs.",
    " Bring a pallet.", " Bring bags.", " A sack.", " A tote.", " A pint.", " A quart.", " A peck.", " A lug.", " A carton.", " A tray.", " A bushel.", " Some flats."];
  for (const a of add) assert.ok(!checkDraft(OFFER + a, F, P).ok, a);
  const c = checkDraft(OFFER + " Maybe 2 pallets.", F, P);
  assert.ok(c.problems.some(p => /2 pallets/.test(p)), String(c.problems));
});

test("weekday prefixes resolve to the delivery day", () => {
  // Fix round 4 made "Frid" fail against Friday; Task 14 asks to confirm it instead (below).
  for (const d of ["Weds", "Thurs.", "Satur", "SATURDAY", "Mon"]) {
    const c = checkDraft(OFFER.replace("Friday", d), F, P);
    assert.equal(c.ok, false, `${d}: ${c.problems}`);
  }
  assert.ok(checkDraft(OFFER.replace("Friday", "Fri"), F, P).ok);
  // Fix round 2: a confirmation item never states the required day on its own.
  assert.deepEqual(checkDraft(OFFER.replace("Friday", "Frid"), F, P), { ok: false, problems: ["Does not state the delivery day (Friday)"], confirm: [{ token: "Frid", question: "Did you mean Friday?" }] });
  assert.ok(!checkDraft(OFFER + " Sat.", F, P).ok);
  assert.ok(!checkDraft(OFFER + " Sun?", F, P).ok);
  assert.ok(!checkDraft(OFFER + " Frid.", { ...F, deliveryOn: "2026-10-29" }, P).ok);
  const s = checkDraft(OFFER + " The sun is out.", F, P);
  assert.ok(s.problems.some(p => /sun/i.test(p)), String(s.problems));
  assert.ok(checkDraft(OFFER + " He sat down.", F, P).problems.some(p => /sat/.test(p)));
});

// Fix round 3: tokenized checker.
test("separators and misspellings cannot hide a day, number, unit or product", () => {
  const bad: [string, RegExp][] = [
    [" _Monday_", /Monday/], [" 5Tuesday", /Tuesday/], [" Wednsday", /Wednsday/], [" Thurday", /Thurday/],
    [" Tuseday", /Tuseday/], [" Mondey", /Mondey/], [" Sat", /Sat/], [" sun", /sun/],
    [" _peas_", /pea/], [" 5peas", /pea/], [" _thirty_", /thirty/], [" twentyfive", /twentyfive/], [" tenfold", /tenfold/],
    [" tonne", /tonne/], [" oz", /oz/], [" ounce", /ounce/], [" bin", /bin/], [" basket", /basket/], [" bale", /bale/],
    [" gallon", /gallon/], [" bundle", /bundle/], [" head", /head/], [" bunch", /bunch/],
    [" Maybe 2 tonnes.", /2 tonnes/], [" Maybe 3 oz.", /3 oz/],
  ];
  for (const [add, re] of bad) {
    const c = checkDraft(OFFER + add, F, ["tomato", "cucumber", "zucchini", "pea"]);
    assert.equal(c.ok, false, add);
    assert.ok(c.problems.some(p => re.test(p)), `${add} -> ${c.problems}`);
  }
  assert.ok(!checkDraft(OFFER + " The sun is out.", F, P).ok);
});

test("adjacent tokens join into product names", () => {
  const K = ["tomato", "cherry tomato", "zucchini"];
  const f = { ...F, kind: "request" as const, substitute: undefined, product: "tomato" };
  for (const t of ["cherry tomatoes", "cherry-tomatoes", "cherrytomatoes", "Cherry_Tomatoes"]) {
    const c = checkDraft(`Could you bring 30 lb of ${t} on Friday?`, f, K);
    assert.ok(!c.ok && c.problems.some(p => /cherry tomato/.test(p)), `${t}: ${c.problems}`);
  }
  assert.ok(checkDraft("Could you bring 30 lb of tomatoes on Friday?", f, K).ok);
  assert.ok(checkDraft("Could you bring 30 lb of tomato-es on Friday?", f, K).problems.every(p => !/cherry/.test(p)));
});

// Fix round 4: every unapproved product is flagged, product mentions are not window-bound,
// and only an explicit day name satisfies the required day.
test("an approved product cannot hide an overlapping unapproved one", () => {
  const req = { ...F, kind: "request" as const, substitute: undefined };
  const c = checkDraft("Could you bring 30 lb of cherrytomatoes on Friday?", { ...req, product: "tomato" }, ["tomato", "cherry tomato"]);
  assert.ok(!c.ok && c.problems.some(p => /cherry tomato/.test(p)), String(c.problems));
  const z = checkDraft("Hi X, we're 30 lb short on tomato for Friday. Would zucchinipeas work for that 30 lb? Reply yes or no.", F, [...P, "pea"]);
  assert.ok(!z.ok && z.problems.some(p => /pea/.test(p)), String(z.problems));
  // An unapproved name inside the approved name is the approved product; a second copy is not.
  const ct = { ...req, product: "cherry tomato" };
  assert.ok(checkDraft("Could you bring 30 lb of cherry tomatoes on Friday?", ct, ["tomato", "cherry tomato"]).ok);
  for (const t of ["cherry tomatoes and tomatoes", "cherrytomatotomatoes", "cherry tomatoes, also tomato"]) {
    const r = checkDraft(`Could you bring 30 lb of ${t} on Friday?`, ct, ["tomato", "cherry tomato"]);
    assert.ok(!r.ok && r.problems.some(p => /Mentions tomato/.test(p)), `${t}: ${r.problems}`);
  }
  // Leftover letters after an approved name and its plural suffix.
  for (const t of ["tomatoespeas", "tomatoescucumber", "tomatopea"]) {
    const r = checkDraft(`Could you bring 30 lb of ${t} on Friday?`, { ...req, product: "tomato" }, ["tomato", "pea", "cucumber"]);
    assert.ok(!r.ok && r.problems.some(p => /Mentions (pea|cucumber)/.test(p)), `${t}: ${r.problems}`);
  }
});

test("a product spelled across many tokens is still found", () => {
  // Letter-spacing a word is the usual way to slip it past a word filter; a model or an editor
  // emphasising a word can produce it too. Neither spelling fits in a 3-token window.
  const K = [...P, "green bean"];
  for (const t of ["g-r-e-e-n bean", "c u c u m b e r s", "cu-cu-m-ber"]) {
    const c = checkDraft(`${OFFER} Or ${t}?`, F, K);
    assert.ok(!c.ok && c.problems.some(p => /Mentions (green bean|cucumber)/.test(p)), `${t}: ${c.problems}`);
  }
});

// Fix round 4 required an explicit day name; Task 14 resolves close misspellings with confidence
// and asks to confirm a word that only might be a day. Neither silently passes.
test("a day is stated by its name, a close misspelling, or a confirmed possible day", () => {
  // Fix round 1 follow-up: "friend" is an ordinary word, not a possible day, so a draft whose
  // only day word is "friend" states no day.
  const c = checkDraft("Hi X, we're 30 lb short on tomato for friend. Would zucchini work for that 30 lb? Reply yes or no.", F, P);
  assert.ok(!c.ok && c.problems.some(p => /Does not state the delivery day/.test(p)) && !c.confirm.length, String(c.problems));
  const none = checkDraft(OFFER.replace("Friday", "soon"), F, P);
  assert.ok(!none.ok && none.problems.some(p => /Does not state the delivery day/.test(p)), String(none.problems));
  for (const d of ["Friday", "friday", "FRIDAY", "Fridays", "Fri", "Fri.", "fri", "Frday", "Fridya", "Frieday"]) {
    assert.deepEqual(checkDraft(OFFER.replace("Friday", d), F, P), { ok: true, problems: [], confirm: [] }, d);
  }
  // Fix round 2: a possible day is still asked about, but does not state the delivery day.
  for (const d of ["Frid", "Fry"]) {
    assert.deepEqual(checkDraft(OFFER.replace("Friday", d), F, P), { ok: false, problems: ["Does not state the delivery day (Friday)"], confirm: [{ token: d, question: "Did you mean Friday?" }] }, d);
  }
  const ex: Record<string, string> = { "2026-10-26": "Mon", "2026-10-27": "Tue", "2026-10-28": "Weds", "2026-10-29": "Thur", "2026-10-31": "Sat", "2026-11-01": "Sun" };
  for (const [on, d] of Object.entries(ex)) assert.ok(checkDraft(OFFER.replace("Friday", d), { ...F, deliveryOn: on }, P).ok, d);
  // "Sunny" is an ordinary word (fix round 1 follow-up); a 5-letter token must be 1 edit from a day.
  for (const w of ["Tuseday", "Sundy", "Thurday"]) {
    const r = checkDraft(`${OFFER} ${w}`, F, P);
    assert.ok(!r.ok && r.problems.some(p => p.includes(`"${w}"`)), `${w}: ${r.problems}`);
  }
  // Task 14 fix round 1: a possible day none of whose readings is the delivery day is a problem,
  // since confirming it would assert a wrong day; it is asked about only when it may be right.
  // The follow-up made "monitor", "thus" and "Wedding" ordinary words, not possible days.
  for (const [w, day] of [["Mo", "Monday"], ["Thr", "Thursday"]]) {
    const r = checkDraft(`${OFFER} ${w}`, F, P);
    assert.ok(!r.ok && r.problems.some(p => p.includes(`"${w}"`) && p.includes(day)), `${w}: ${r.problems}`);
    assert.deepEqual(r.confirm, [], w);
  }
  assert.deepEqual(checkDraft(`${OFFER} Mo`, { ...F, deliveryOn: "2026-10-26" }, P).confirm, [{ token: "Mo", question: "Did you mean Monday?" }]);
  assert.deepEqual(checkDraft(OFFER.replace("Friday", "Mon"), { ...F, deliveryOn: "2026-10-26" }, P).confirm, []);
});

test("template passes across kinds, amounts, units and every weekday", () => {
  const K = ["tomato", "cherry tomato", "zucchini", "cucumber", "pea", "peach", "green bean", "blueberry", "kale", "corn"];
  const amounts: [number, "lb" | "g" | "each"][] = [[1, "lb"], [2.5, "lb"], [30, "lb"], [480, "lb"], [500, "g"], [15500, "g"], [30000, "g"], [1, "each"], [12, "each"], [144, "each"]];
  for (let day = 1; day <= 7; day++) {
    const deliveryOn = `2026-11-0${day}`;
    for (const kind of ["request", "offer", "notice"] as const) {
      for (const [amount, unit] of amounts) {
        const f: MessageFacts = { ...F, kind, amount, unit, deliveryOn };
        const c = checkDraft(template(f), f, K);
        assert.deepEqual(c, { ok: true, problems: [], confirm: [] }, `${deliveryOn} ${kind} ${amount} ${unit}`);
      }
    }
  }
});

test("approved product words are not read as units, days or number words", () => {
  for (const [product, substitute] of [["head lettuce", "sunchoke"], ["butternut squash", "four-leaf kale"]]) {
    for (const kind of ["request", "offer", "notice"] as const) {
      const f = { ...F, kind, product, substitute };
      assert.deepEqual(checkDraft(template(f), f, [product, substitute, "kale"]), { ok: true, problems: [], confirm: [] }, `${kind} ${product}`);
    }
  }
  assert.ok(!checkDraft(`${OFFER} One head.`, F, P).ok);
});

// Task 14: shorthand resolves to its meaning, then the meaning is checked; a fact-like word
// that cannot be resolved with confidence becomes a confirmation item.
test("relative days resolve against the day the draft is written", () => {
  const tmrw = OFFER.replace("Friday", "tmrw");
  assert.deepEqual(checkDraft(tmrw, F, P, "2026-10-29"), { ok: true, problems: [], confirm: [] });
  const wed = checkDraft(tmrw, F, P, "2026-10-28");
  assert.ok(!wed.ok && wed.problems.includes(`"tmrw" means Thursday; the delivery is Friday`), String(wed.problems));
  // Fix round 2: without a writing date "tmrw" is asked about and does not state the day.
  assert.deepEqual(checkDraft(tmrw, F, P), { ok: false, problems: ["Does not state the delivery day (Friday)"], confirm: [{ token: "tmrw", question: `"tmrw" — which day is that?` }] });
});

test("misspelt products resolve to the product they name", () => {
  const req = { ...F, kind: "request" as const, substitute: undefined };
  const txt = "Could you bring 30 lb of cucumbre on Friday?";
  assert.deepEqual(checkDraft(txt, { ...req, product: "cucumber" }, P), { ok: true, problems: [], confirm: [] });
  const c = checkDraft(txt, { ...req, product: "tomato" }, ["tomato", "cucumber"]);
  assert.ok(!c.ok && c.problems.some(p => /Mentions cucumber/.test(p)), String(c.problems));
});

test("number words and misspellings resolve to their value", () => {
  const req = { ...F, kind: "request" as const, substitute: undefined, product: "tomato" };
  const txt = "Could you bring twnty lb of tomatoes on Friday?";
  assert.deepEqual(checkDraft(txt, { ...req, amount: 20 }, P), { ok: true, problems: [], confirm: [] });
  const c = checkDraft(txt, { ...req, amount: 30 }, P);
  assert.ok(!c.ok && c.problems.some(p => /twnty lb/.test(p)), String(c.problems));
});

test("an unclear day abbreviation asks to confirm", () => {
  const c = checkDraft(OFFER.replace("Friday", "Thr"), { ...F, deliveryOn: "2026-10-29" }, P);
  // Fix round 2: still asked about, but a question cannot state the required day.
  assert.deepEqual(c, { ok: false, problems: ["Does not state the delivery day (Thursday)"], confirm: [{ token: "Thr", question: "Did you mean Thursday?" }] });
});

test("a required product must be a whole word that names it", () => {
  const c = checkDraft("Could you bring 30 lb on Friday? Speak soon.", { ...F, kind: "request", substitute: undefined, product: "pea" }, ["pea"]);
  assert.ok(!c.ok && c.problems.some(p => /Does not mention pea/.test(p)), String(c.problems));
});

test("templates give no problems and no confirmation items", () => {
  const K = ["tomato", "cherry tomato", "zucchini", "cucumber", "pea", "peach", "green bean", "blueberry", "kale", "corn"];
  for (let day = 1; day <= 7; day++) for (const kind of ["request", "offer", "notice"] as const) for (const [amount, unit] of [[1, "lb"], [20, "lb"], [12, "each"], [2500, "g"]] as const) {
    const f: MessageFacts = { ...F, kind, amount, unit, deliveryOn: `2026-11-0${day}` };
    for (const on of [undefined, "2026-10-28"]) assert.deepEqual(checkDraft(template(f), f, K, on), { ok: true, problems: [], confirm: [] }, `${f.deliveryOn} ${kind} ${amount}`);
  }
});

test("ambiguous products ask, digit shorthand resolves, and number runs read as one number", () => {
  const req = { ...F, kind: "request" as const, substitute: undefined, product: "cucumber" };
  const both = checkDraft("Could you bring 30 lb of cucumberz on Friday?", req, ["cucumber", "cucumbers"]);
  assert.deepEqual(both.confirm, [{ token: "cucumberz", question: "Did you mean cucumber or cucumbers?" }]);
  // Fix round 2: an ambiguous reading does not mention the required product.
  assert.deepEqual(both.problems, ["Does not mention cucumber"]);
  // Close to two products, neither approved: wrong whichever it means.
  const neither = checkDraft("Could you bring 30 lb of cucumbers on Friday? Or melonz.", req, ["cucumber", "melon", "melons"]);
  assert.ok(!neither.ok && neither.problems.some(p => /melon/.test(p)), String(neither.problems));
  assert.deepEqual(checkDraft(OFFER.replace("Friday", "2moro"), F, P, "2026-10-29"), { ok: true, problems: [], confirm: [] });
  assert.ok(checkDraft(OFFER.replace("30 lb", "twenty-five lb"), F, P).problems.some(p => /twenty-five lb/.test(p)));
  assert.ok(checkDraft(OFFER.replace("30 lb", "thirty-five pounds"), { ...F, amount: 35 }, P).ok);
  assert.ok(checkDraft(OFFER.replace("30 lb", "two dozen each"), { ...F, amount: 24, unit: "each" }, P).ok);
  assert.ok(checkDraft(OFFER.replace("30 lb", "doz each"), { ...F, amount: 12, unit: "each" }, P).ok);
  // Fix round 1: a lone fuzzy number is asked about only when its reading is the decision's amount.
  assert.deepEqual(checkDraft(`${OFFER} Maybe twnty?`, { ...F, amount: 20 }, P).confirm, [{ token: "twnty", question: "Did you mean 20?" }]);
  assert.ok(checkDraft(`${OFFER} Maybe twnty?`, F, P).problems.some(p => /twnty/.test(p)));
  assert.throws(() => checkDraft(OFFER, F, P, "tomorrow"), /writing date/);
});

test("a misspelt product cannot hide behind letter spacing or separators", () => {
  const K = [...P, "green bean"];
  for (const t of ["c-u-c-u-m-b-r-e", "c u c u m b r e", "grene bean", "g-r-e-e-n bena"]) {
    const c = checkDraft(`${OFFER} Or ${t}?`, F, K);
    assert.ok(!c.ok && c.problems.some(p => /Mentions (cucumber|green bean)/.test(p)), `${t}: ${c.problems}`);
  }
  assert.ok(checkDraft(OFFER.replace("zucchini", "zuchini"), F, P).ok);
});

// Task 14 fix round 1: confirming must never be able to assert a wrong fact, misspelt days that
// drop a letter are read, fuzzy products leave common words alone, a longer unapproved product is
// not hidden by an approved one inside it, and more relative-day shorthand is resolved.
test("a confirmation item only asks about a reading that could be right", () => {
  // Friday delivery, the message says Friday, amount 30 lb.
  for (const w of ["Thr", "Satur", "Mo", "Sa", "Su", "Tu", "Th", "Thsday", "Satday"]) {
    const c = checkDraft(`${OFFER} Or ${w}?`, F, P);
    assert.ok(!c.ok && c.problems.some(p => p.includes(`"${w}"`)), `${w}: ${c.problems}`);
    assert.deepEqual(c.confirm, [], w);
  }
  assert.deepEqual(checkDraft(`${OFFER} Or Frid?`, F, P), { ok: true, problems: [], confirm: [{ token: "Frid", question: "Did you mean Friday?" }] });
  for (const t of ["Or twnty?", "Or twnty punds?"]) {
    const c = checkDraft(`${OFFER} ${t}`, F, P);
    assert.ok(!c.ok && c.problems.some(p => /twnty/.test(p)), `${t}: ${c.problems}`);
    assert.deepEqual(c.confirm, [], t);
  }
  const req = { ...F, kind: "request" as const, substitute: undefined, amount: 20 };
  assert.deepEqual(checkDraft("Could you bring twnty lb of tomatoes on Friday?", req, P), { ok: true, problems: [], confirm: [] });
});

test("a misspelt day that drops its first letter is still read", () => {
  const on: Record<string, string> = { hursday: "2026-10-29", uesday: "2026-10-27", unday: "2026-11-01", aturday: "2026-10-31", ednesday: "2026-10-28", onday: "2026-10-26" };
  for (const [w, deliveryOn] of Object.entries(on)) {
    const c = checkDraft(`${OFFER} Or ${w}?`, F, P);
    assert.ok(!c.ok && c.problems.some(p => p.includes(`"${w}"`)), `${w}: ${c.problems}`);
    assert.deepEqual(checkDraft(OFFER.replace("Friday", w), { ...F, deliveryOn }, P), { ok: true, problems: [], confirm: [] }, w);
  }
});

const CATALOG = ["tomato", "cherry tomato", "cucumber", "zucchini", "pea", "peach", "bean", "green bean", "kale", "corn", "sorrel", "thyme", "mache", "couve",
  "chard", "beet", "leek", "onion", "garlic", "pepper", "basil", "apple", "pear", "plum", "squash", "melon", "lettuce", "spinach", "carrot", "radish", "potato",
  "sweet potato", "butternut squash", "blueberry", "strawberry", "fennel", "turnip", "shallot", "rhubarb", "okra"];

test("common words are not read as products", () => {
  const K = [...P, "sorrel", "thyme", "mache", "couve"];
  assert.deepEqual(checkDraft(`${OFFER} Sorry, the much could check.`, F, K), { ok: true, problems: [], confirm: [] });
});

test("templates pass against a realistic produce catalog", () => {
  const pairs = [["tomato", "zucchini"], ["green bean", "bean"], ["pea", "sorrel"], ["cherry tomato", "chard"], ["kale", "spinach"], ["thyme", "basil"], ["potato", "sweet potato"], ["couve", "mache"]];
  const amounts: [number, "lb" | "g" | "each"][] = [[1, "lb"], [2.5, "lb"], [30, "lb"], [480, "lb"], [500, "g"], [15500, "g"], [12, "each"], [144, "each"]];
  for (let day = 1; day <= 7; day++) for (const kind of ["request", "offer", "notice"] as const) for (const [amount, unit] of amounts) for (const [product, substitute] of pairs) {
    const f: MessageFacts = { ...F, kind, product, substitute, amount, unit, deliveryOn: `2026-11-0${day}` };
    for (const on of [undefined, "2026-10-28"]) {
      assert.deepEqual(checkDraft(template(f), f, CATALOG, on), { ok: true, problems: [], confirm: [] }, `${f.deliveryOn} ${kind} ${amount} ${unit} ${product}/${substitute} ${on}`);
    }
  }
});

test("an approved product inside a misspelt longer one does not hide it", () => {
  const req = { ...F, kind: "request" as const, substitute: undefined };
  const K = ["tomato", "cherry tomato", "zucchini", "bean", "green bean"];
  for (const t of ["chery tomatoes", "cheri tomato"]) {
    const c = checkDraft(`Could you bring 30 lb of ${t} on Friday?`, { ...req, product: "tomato" }, K);
    assert.ok(!c.ok && c.problems.some(p => /Mentions cherry tomato/.test(p)), `${t}: ${c.problems}`);
  }
  const g = checkDraft("Could you bring 30 lb of grene bean on Friday?", { ...req, product: "bean" }, K);
  assert.ok(!g.ok && g.problems.some(p => /Mentions green bean/.test(p)), String(g.problems));
});

test("more relative-day shorthand resolves, and unknown shorthand is asked about", () => {
  for (const w of ["tmr", "tmro", "tmrow", "tmoro", "tomoz"]) {
    const t = OFFER.replace("Friday", w);
    assert.deepEqual(checkDraft(t, F, P, "2026-10-29"), { ok: true, problems: [], confirm: [] }, w);
    assert.ok(checkDraft(t, F, P, "2026-10-28").problems.includes(`"${w}" means Thursday; the delivery is Friday`), w);
    assert.deepEqual(checkDraft(t, F, P).confirm, [{ token: w, question: `"${w}" — which day is that?` }], w);
  }
  assert.deepEqual(checkDraft(OFFER.replace("Friday", "tday"), F, P, "2026-10-30"), { ok: true, problems: [], confirm: [] });
  assert.ok(checkDraft(OFFER.replace("Friday", "tday"), F, P, "2026-10-29").problems.some(p => /"tday" means Thursday/.test(p)));
  for (const w of ["tmz", "tomo", "tmrww", "tomrw"]) {
    for (const on of [undefined, "2026-10-29"]) {
      assert.deepEqual(checkDraft(`${OFFER} Or ${w}?`, F, P, on).confirm, [{ token: w, question: `"${w}" — which day is that?` }], `${w} ${on}`);
    }
  }
  // Tomato is never read as shorthand for tomorrow, even outside the catalog.
  assert.deepEqual(checkDraft(`${OFFER} Tomatoes!`, { ...F, product: "kale" }, ["kale", "zucchini"]).confirm, []);
  for (const d of ["two days", "2 days", "twodays", "2days"]) {
    const t = OFFER.replace("on Friday", `in ${d}`);
    assert.deepEqual(checkDraft(t, F, P), { ok: false, problems: ["Does not state the delivery day (Friday)"], confirm: [{ token: d, question: `"${d}" — which day is that?` }] }, d);
    assert.deepEqual(checkDraft(t, F, P, "2026-10-28"), { ok: true, problems: [], confirm: [] }, d);
    assert.ok(checkDraft(t, F, P, "2026-10-29").problems.includes(`"${d}" means Saturday; the delivery is Friday`), d);
  }
});

test("a long run of glued letters is checked quickly", () => {
  const K = ["tomato", "zucchini", "cherry tomato", "green bean", "butternut squash", "eight ball squash", "four leaf kale", "sweet potato", "purple sprouting broccoli", "red russian kale", "cucumber", "blueberry"];
  for (const s of ["a ".repeat(240), "ab-".repeat(160), "ab ".repeat(160), "e-".repeat(240), "abcdefgh ".repeat(53), "a-b ".repeat(120)]) {
    const t = performance.now();
    checkDraft(s.slice(0, 480), F, K);
    const ms = performance.now() - t;
    assert.ok(ms < 500, `${JSON.stringify(s.slice(0, 6))}: ${ms.toFixed(0)} ms`);
  }
});

// Fix round 1 follow-up: an ordinary word that only shares a prefix with a day is not a day. A
// possible day is an explicit form, a close misspelling, or a prefix look-alike of 5 letters or fewer.
test("ordinary words are not read as days", () => {
  for (const w of ["satisfied", "sunny", "month", "monthly", "thunder", "thumb", "sunset", "friendly", "friend", "thus", "monitor", "Wedding", "fridge", "midday", "may"]) {
    const c = checkDraft(`${OFFER} It was ${w}.`, F, P);
    assert.deepEqual(c, { ok: true, problems: [], confirm: [] }, `${w}: ${c.problems} ${JSON.stringify(c.confirm)}`);
  }
  for (const w of ["Thr", "Satur"]) {
    const c = checkDraft(`${OFFER} Or ${w}?`, F, P);
    assert.ok(!c.ok && c.problems.some(p => p.includes(`"${w}"`)), `${w}: ${c.problems}`);
  }
  // Fix round 2: a confirmation item never states the required day on its own.
  assert.deepEqual(checkDraft(OFFER.replace("Friday", "Frid"), F, P), { ok: false, problems: ["Does not state the delivery day (Friday)"], confirm: [{ token: "Frid", question: "Did you mean Friday?" }] });
  assert.ok(checkDraft(OFFER.replace("Friday", "Weds"), { ...F, deliveryOn: "2026-10-28" }, P).ok);
  assert.ok(!checkDraft(`${OFFER} Or Weds?`, F, P).ok);
  // Known product words are not read as look-alike days, but an explicit day form still is.
  const K = [...P, "sunchoke", "sunflower", "sun gold tomato"];
  assert.deepEqual(checkDraft(OFFER.replace("zucchini", "sunchoke"), { ...F, substitute: "sunchoke" }, K), { ok: true, problems: [], confirm: [] });
  assert.ok(checkDraft(`${OFFER} Or Sun?`, F, K).problems.some(p => /"Sun"/.test(p)));
});

// Task 14 fix round 2: day phrases, required facts stated only by confident readings,
// vowel-dropped day shorthand, and misspelt lone numbers.
test("a phrase that shifts a day is resolved against the writing date or asked about", () => {
  const wed = "2026-10-28";
  // Written Wednesday for Friday 2026-10-30: only "the day after tomorrow" lands on the delivery.
  for (const p of ["the day after tomorrow", "day after tmrw"]) {
    assert.deepEqual(checkDraft(OFFER.replace("on Friday", p), F, P, wed), { ok: true, problems: [], confirm: [] }, p);
    const tue = checkDraft(OFFER.replace("on Friday", p), F, P, "2026-10-27");
    assert.ok(!tue.ok && tue.problems.some(x => x.includes(`"${p}" means Thursday`)), `${p}: ${tue.problems}`);
  }
  for (const p of ["tomorrow week", "a week tomorrow", "next Friday", "Friday week", "Friday after next", "a week from Friday", "Friday fortnight"]) {
    const c = checkDraft(OFFER.replace("on Friday", p), F, P, wed);
    assert.ok(!c.ok && c.problems.some(x => x.includes(`"${p}"`)), `${p}: ${c.problems}`);
    assert.deepEqual(c.confirm, [], p);
    const extra = checkDraft(`${OFFER} Or ${p}?`, F, P, wed);
    assert.ok(!extra.ok && extra.problems.some(x => x.includes(`"${p}"`)), `${p}: ${extra.problems}`);
  }
  assert.ok(checkDraft(OFFER.replace("on Friday", "next Friday"), F, P, wed).problems.includes(`"next Friday" means Friday 2026-11-06; the delivery is Friday 2026-10-30`));
  // Without a writing date: asked about when a reading could be the delivery, a problem when none can.
  for (const p of ["next Friday", "Friday week", "Friday after next", "a week from Friday", "Friday fortnight"]) {
    assert.deepEqual(checkDraft(`${OFFER} Or ${p}?`, F, P), { ok: true, problems: [], confirm: [{ token: p, question: `"${p}": which date is that?` }] }, p);
  }
  for (const p of ["the day after tomorrow", "tomorrow week", "a week tomorrow"]) {
    assert.deepEqual(checkDraft(`${OFFER} Or ${p}?`, F, P).confirm, [{ token: p, question: `"${p}": which date is that?` }], p);
  }
  const mon = checkDraft(`${OFFER} Or next Monday?`, F, P);
  assert.ok(!mon.ok && mon.problems.some(x => x.includes(`"next Monday"`)) && !mon.confirm.length, String(mon.problems));
  // A modifier in another sentence does not touch the day.
  assert.deepEqual(checkDraft(`${OFFER} Reply after lunch.`, F, P), { ok: true, problems: [], confirm: [] });
  assert.deepEqual(checkDraft(`${OFFER} Or next week?`, F, P).confirm, [{ token: "next week", question: `"next week" — which day is that?` }]);
});

test("a confirmation item never states a required fact", () => {
  const tom = checkDraft("Could you take 30 lb of zucchini instead of tomatoes? Tom says hi.", F, P);
  assert.deepEqual(tom, { ok: false, problems: ["Does not state the delivery day (Friday)"], confirm: [{ token: "Tom", question: `"Tom" — which day is that?` }] });
  const req = { ...F, kind: "request" as const, substitute: undefined, amount: 20 };
  const amt = checkDraft("Could you bring twnty of tomatoes on Friday?", req, P);
  assert.deepEqual(amt, { ok: false, problems: ["No amount stated"], confirm: [{ token: "twnty", question: "Did you mean 20?" }] });
});

test("day shorthand with the vowels dropped is read", () => {
  const own: Record<string, string> = { Mndy: "2026-10-26", Tsdy: "2026-10-27", Wdnsdy: "2026-10-28", Thrsdy: "2026-10-29", Frdy: "2026-10-30", Strdy: "2026-10-31", Sndy: "2026-11-01" };
  for (const [w, deliveryOn] of Object.entries(own)) {
    assert.deepEqual(checkDraft(OFFER.replace("Friday", w), { ...F, deliveryOn }, P), { ok: true, problems: [], confirm: [] }, w);
    if (w === "Frdy") continue;
    const c = checkDraft(`${OFFER} Or ${w}?`, F, P);
    assert.ok(!c.ok && c.problems.some(p => p.includes(`"${w}"`)), `${w}: ${c.problems}`);
  }
  // Ordinary words with vowels are not shorthand.
  for (const w of ["sandy", "sturdy", "Mindy"]) assert.deepEqual(checkDraft(`${OFFER} It was ${w}.`, F, P), { ok: true, problems: [], confirm: [] }, w);
});

test("misspelt lone numbers get a reading", () => {
  for (const [w, n] of [["wenty", 20], ["thrity", 30], ["hirty", 30]] as const) {
    const wrong = checkDraft(`${OFFER} Or ${w}?`, { ...F, amount: n === 20 ? 30 : 20 }, P);
    assert.ok(wrong.problems.some(p => p.includes(`"${w}" reads as ${n}`)), `${w}: ${wrong.problems}`);
    assert.deepEqual(checkDraft(`${OFFER} Or ${w}?`, { ...F, amount: n }, P).confirm, [{ token: w, question: `Did you mean ${n}?` }], w);
    assert.deepEqual(checkDraft(OFFER.replace("30 lb", `${w} lb`), { ...F, amount: n }, P), { ok: true, problems: [], confirm: [] }, w);
  }
  // Ordinary words a letter or two from a number are not numbers.
  for (const w of ["right", "light", "night", "weight", "height", "even", "went", "tent", "plenty", "mighty", "dirty", "there"]) {
    assert.deepEqual(checkDraft(`${OFFER} It is ${w}.`, F, P), { ok: true, problems: [], confirm: [] }, w);
  }
});

test("number words of 6+ letters allow 2 edits, and any first letter may differ", () => {
  // 2 edits from a 6+ letter number word; a substituted first letter on a 5+ letter one.
  for (const [w, n] of [["twentee", 20], ["rwenty", 20], ["ywelve", 12], ["dight", 8], ["thirrtey", 30]] as const) {
    const wrong = checkDraft(`${OFFER} Or ${w}?`, { ...F, amount: n === 20 ? 30 : 20 }, P);
    assert.ok(wrong.problems.some(p => p.includes(`"${w}" reads as ${n}`)), `${w}: ${wrong.problems}`);
    assert.deepEqual(checkDraft(`${OFFER} Or ${w}?`, { ...F, amount: n }, P).confirm, [{ token: w, question: `Did you mean ${n}?` }], w);
  }
  // 5-letter number words still allow only 1 edit: "fiftee" is 2 from fifty.
  assert.deepEqual(checkDraft(`${OFFER} It is fiftee.`, { ...F, amount: 50 }, P).confirm, [], "fiftee");
  // Ordinary words the wider rule would reach are not numbers.
  for (const w of ["level", "clever", "handled", "hunted", "mission", "events", "trendy", "tweet", "thinly", "sight", "fight", "tight", "nifty", "minty", "piety", "shirt", "sweaty", "treaty", "winery", "nicely", "highly"]) {
    assert.deepEqual(checkDraft(`${OFFER} It is ${w}.`, F, P), { ok: true, problems: [], confirm: [] }, w);
  }
});

test("words that name built-in object properties are ordinary words", () => {
  for (const w of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
    assert.deepEqual(checkDraft(`${OFFER} It is ${w}.`, F, P), { ok: true, problems: [], confirm: [] }, w);
    assert.deepEqual(checkDraft(`${OFFER} It is 2${w}.`, F, P).confirm, [], w);
  }
});

// Task 14 fix round 3: shift words are judged by sentence; past phrases; day skeletons.
const WED = "2026-10-28";
const shifted = (p: string, on?: string) => checkDraft(OFFER.replace("on Friday", p), F, P, on);
const names = (c: { problems: string[]; confirm: { token: string }[] }, p: string) => c.problems.some(x => x.includes(`"${p}"`)) || c.confirm.some(x => x.token === p);

test("past and before phrases are not the delivery", () => {
  for (const p of ["the day before Friday", "last Friday", "Friday last", "the previous Friday", "the Friday prior", "Friday gone", "Friday just gone"]) {
    const c = shifted(p, WED);
    assert.ok(!c.ok && c.problems.some(x => x.includes(`"${p}"`)), `${p}: ${JSON.stringify(c)}`);
    assert.deepEqual(c.confirm, [], p);
  }
  assert.ok(shifted("the day before Friday", WED).problems.includes(`"the day before Friday" means Thursday; the delivery is Friday`));
  assert.ok(shifted("last Friday", WED).problems.includes(`"last Friday" means Friday 2026-10-23; the delivery is Friday 2026-10-30`));
  // "before" alone is ambiguous: asked about, and it does not state the day.
  const before = shifted("the Friday before", WED);
  assert.ok(!before.ok && names(before, "the Friday before"), JSON.stringify(before));
  // With no writing date, every phrase is a question and the day is not stated.
  for (const p of ["last Friday", "the Friday prior", "Friday gone"]) {
    const c = shifted(p);
    assert.ok(!c.ok && c.problems.includes("Does not state the delivery day (Friday)") && names(c, p), `${p}: ${JSON.stringify(c)}`);
  }
});

test("shift words in shorthand, misspelt or glued are read", () => {
  for (const p of ["nxt Friday", "nxt Fri", "Friday nxt", "Fri wk", "Friday wk", "Frdy wk", "Friday nextweek", "Friday fortnite", "Friday folowing", "Friday b4"]) {
    const c = shifted(p, WED);
    assert.ok(!c.ok && names(c, p), `${p}: ${JSON.stringify(c)}`);
    assert.ok(!c.problems.some(x => /Number "4"/.test(x)), `${p}: ${c.problems}`);
  }
  assert.ok(shifted("nxt Friday", WED).problems.includes(`"nxt Friday" means Friday 2026-11-06; the delivery is Friday 2026-10-30`));
  assert.ok(shifted("Friday fortnite", WED).problems.includes(`"Friday fortnite" means Friday 2026-11-13; the delivery is Friday 2026-10-30`));
  // On the right date the shorthand resolves and states the day.
  assert.deepEqual(checkDraft(OFFER.replace("on Friday", "Friday wk"), { ...F, deliveryOn: "2026-11-06" }, P, WED), { ok: true, problems: [], confirm: [] });
});

test("a shift word anywhere in the sentence takes away the day's confidence", () => {
  for (const p of ["Friday in a week", "Friday in a fortnight", "Friday of the following wk", "Friday, a week later", "next, Friday", "next week, Friday", "Friday (next week)"]) {
    const c = shifted(p, WED);
    assert.ok(!c.ok && c.problems.some(x => x.includes(`"${p}"`)), `${p}: ${JSON.stringify(c)}`);
    assert.deepEqual(c.confirm, [], p);
  }
  // Commas do not split a sentence: the day is asked about, never stated, and never confirmed as wrong.
  const far = checkDraft("Could you take 30 lb of zucchini instead of tomatoes on Friday, or is that too soon after the last delivery?", F, P, WED);
  assert.ok(!far.ok && far.problems.includes("Does not state the delivery day (Friday)") && far.confirm.length === 1, JSON.stringify(far));
  // Next week, with no day: a problem when no day of next week is the delivery.
  assert.ok(checkDraft(`${OFFER} Or next week?`, F, P, WED).problems.some(x => x.includes(`"next week"`)));
  assert.deepEqual(checkDraft(`${OFFER} Or next week?`, { ...F, deliveryOn: "2026-11-06" }, P, WED).confirm.map(x => x.token), ["next week"]);
});

test("ambiguous shift words are asked about, not problems", () => {
  for (const on of [WED, undefined]) {
    for (const s of ["Thanks, see you Friday after lunch.", "Friday from the farm.", "Friday before noon works."]) {
      const c = checkDraft(`${OFFER} ${s}`, F, P, on);
      assert.deepEqual(c.problems, [], `${s} ${on}`);
      assert.ok(c.confirm.length <= 1, `${s} ${on}: ${JSON.stringify(c.confirm)}`);
    }
  }
  // Times are not read (the "2" of "2pm" is a number not in the decision), but the day is only asked about.
  const pm = checkDraft(`${OFFER} Thanks, see you Friday after 2pm.`, F, P, WED);
  assert.deepEqual(pm.problems, [`Number "2" is not in the decision`]);
  assert.deepEqual(pm.confirm, [{ token: "Friday after", question: `"Friday after": which date is that?` }]);
  // Template wording never pairs a shift word with a day.
  for (const kind of ["request", "offer", "notice"] as const) {
    const f = { ...F, kind };
    assert.deepEqual(checkDraft(template(f), f, P, WED), { ok: true, problems: [], confirm: [] }, kind);
  }
});

test("day skeletons allow one edit at 4+ consonants, plurals, and shorter skeleton look-alikes", () => {
  for (const w of ["Wds", "Wdns", "Wdsdy", "Wnsdy", "Mnd", "Snd", "Mndys", "Sndys", "Strdys", "Tsdys", "Wdnsdys"]) {
    const c = checkDraft(`${OFFER} Or ${w}?`, F, P);
    assert.ok(!c.ok && c.problems.some(p => p.includes(`"${w}"`)), `${w}: ${JSON.stringify(c)}`);
    assert.deepEqual(c.confirm, [], w);
  }
  const own: Record<string, string> = { Wdsdy: "2026-10-28", Wnsdy: "2026-10-28", Mndys: "2026-10-26", Sndys: "2026-11-01", Strdys: "2026-10-31", Tsdys: "2026-10-27", Wdnsdys: "2026-10-28" };
  for (const [w, deliveryOn] of Object.entries(own)) assert.deepEqual(checkDraft(OFFER.replace("Friday", w), { ...F, deliveryOn }, P), { ok: true, problems: [], confirm: [] }, w);
  // Short look-alikes are only possible days: asked about on their own day, never stating it.
  assert.deepEqual(checkDraft(`${OFFER} Or Wds?`, { ...F, deliveryOn: "2026-10-28" }, P).confirm, [{ token: "Wds", question: "Did you mean Wednesday?" }]);
  for (const w of ["thx", "hrs", "pls", "msg", "thks", "smth", "frm", "try", "sty", "shy", "dry"]) assert.deepEqual(checkDraft(`${OFFER} ${w}.`, F, P).problems, [], w);
});
