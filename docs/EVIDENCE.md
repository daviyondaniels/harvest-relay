# Evidence register

Status: compiled 2026-10-28 from desk research, with no coordinator interviews yet.

Every product decision in Harvest Relay should trace to a row here, or be named as an
assumption still to test. The design documents cite rows as **E1**, **E2**, and so on.

**How the sources were read:**
- Read in full:
  - the 2017 and 2025 National Food Hub Survey reports;
  - the USDA study of food hub closures;
  - the Cornell, WSU and UVM case studies;
  - Farmhand's public pages.
- Marked [S]: figures that came from search summaries and have not been checked against
  the original document. Check these before quoting them anywhere public.

## What the evidence says

### The problem is real, but nobody has measured it

- **Hubs rank it first.** "Balancing supply and demand" was the top challenge in every
  National Food Hub Survey from 2013 to 2019. The share of hubs putting it in their top
  three was 59% (2013), 48% (2015) and 55% (2017).
  ([2017 survey](https://search.issuelab.org/resources/33289/33289.pdf))
- **Hubs handle shortfalls with a routine.** Farmers notify staff "so that they can
  source product from another member or non-member, or when necessary notify the customer
  that the product is not available." One co-op buys 5 to 10% of its product from
  non-members to cover gaps.
  ([Cornell Dyson EB 2015-04](http://publications.dyson.cornell.edu/outreach/extensionpdf/2015/Cornell-Dyson-eb1504.pdf))
- **A closed hub lacked exactly this.** FoodEx's marketplace "was not equipped to track
  whether a farmer was going to run out of a certain crop by a specified delivery date."
  Arganica's orders were "often … late, misplaced, or inaccurate."
  ([USDA, Running a Food Hub Vol. 4, 2017](https://permanent.fdlp.gov/gpo82747/SR77_FoodHubs_Vol4_0.pdf))
- **The window is hours.** At Puget Sound Food Hub, buyers order by Sunday, growers drop
  off by 2 p.m. Monday, and delivery is Tuesday.
  ([WSU case studies, 2021](https://wpcdn.web.wsu.edu/wp-extension/uploads/sites/2056/2021/06/Draft-All-Hubs-Case-studies_21.06.08.pdf))
- **Changes travel by phone, and staff re-key them.**
  - "Communication by phone daily and sometimes hourly is necessary during the harvest
    season." (Cornell 2015)
  - The early mix of "spreadsheets, email, and phone calls … took a lot of time and was
    prone to human error."
    ([UVM, 2026](https://scholarworks.uvm.edu/server/api/core/bitstreams/52b9e494-ba46-4845-867e-9b7766311a13/content))
- **Platforms leave shortfalls to email and phone.** Open Food Network answers "a crop
  failure and we have fewer tomatoes … than we need" with manual bulk edits and customers
  who "contact you by email or phone."
  ([OFN troubleshooting](https://guide.openfoodnetwork.org/trouble-shooting))
- **Nothing is counted.** No published source gives a food hub fill rate, how often
  orders are shorted, coordinator hours per shortfall, or how a hub chooses which buyer
  is shorted.

### Counter-evidence

- **It no longer ranks first.** In 2025, consistent access to products (33%) and
  inventory management (20%) trail managing growth (51%), access to capital (46%) and
  making sales (46%).
  ([2025 survey](https://msu-prod.dotcms.cloud/foodsystems/uploads/files/National-Food-Hub-Survey-Report-2025%20Final.pdf))
- **Hubs survive without it.** About 88% of hubs survive five years. Closures are blamed
  mainly on management and business model, not order handling. (USDA Vol. 4)
- **The market is small and thin-margined.**
  - About 240 to 360 US hubs.
  - In 2017, a median of $489K revenue, 40 producers and 6 staff.
  - An average margin of −2%.
    ([NSAC on the benchmarking study](https://sustainableagriculture.net/blog/food-hub-profitability-study/))
  - 51% of hubs were highly grant-dependent in 2025.
- **Federal buying was cut.** USDA cancelled about $660M of Local Food for Schools and
  $420M of LFPA funding in March 2025.
  ([HPPR](https://www.hppr.org/hppr-news/2025-03-14/usda-ends-programs-that-help-schools-and-food-banks-buy-locally-grown-food))

### What existing tools cover

- **Pick and packing lists are standard.** Local Food Marketplace includes them on every
  plan, at $149 to $349 a month.
  ([LFM pricing](https://home.localfoodmarketplace.com/pricing/))
- **Farmhand is the closest competitor.**
  - It says "Send a new grower's price list by text and we list it." When a grower is
    short, "the swap lands on every box and on the pack list."
    ([Farmhand food hubs](https://www.farmhand.partners/food-hubs))
  - Its own staff act on what the AI recommends: "a person on our team reviews what the
    system recommends, validates it, and takes the action."
    ([Farmhand on AI](https://farmhand.partners/blog/how-farmhand-uses-ai))
  - Its public pages show no hub-side review, no per-buyer shortfall detection, and no
    buyer consent.
- **AI already reads orders in the other direction.** Choco and Pepper read buyer orders
  into distributor systems. Pepper "flags uncertainty instead of guessing."
  ([Pepper](https://www.usepepper.com/post/streamlining-orders-with-peppers-ai-order-automation-order-agent))
- **The gap, judged from public documentation only:** no tool combines five things:
  - a coordinator review of a model-read grower message, with the grower's quoted words;
  - approval blocked until pack size or total-versus-added is clarified;
  - detection of which buyer orders a cut breaks;
  - substitution only after recorded buyer consent;
  - pick lists drawn from a plan locked against changes.

### Who the buyers are (2025 survey)

- **Business models:** 33% of hubs are mainly wholesale, 33% hybrid and 29% mainly direct
  to consumer.
- **Who hubs sell to:** 50% sell to K-12 schools and 47% to food banks.
- **Average share of a hub's sales:** schools 10%, food banks 11%, restaurants 10% and
  small retailers 5%.
- **Schools feel the shortfall most:** 32% of hubs selling to schools cite "not enough
  product to meet demand," twice the rate for food banks.

### Consent norms differ by buyer

- **Institutions require approval first.** Institutional procurement requires approval
  before a substitute is delivered
  ([DC SFSP procurement](https://www.capitalareafoodbank.org/wp-content/uploads/2016/03/DC-SFSP-Small-Purchase-Procurement-05.10.16.pdf)) [S].
- **CSAs take blanket consent at sign-up.**
  ([example terms](https://warnerfarm.localfoodmarketplace.com/Home/Page/terms_of_service)) [S]
- **Food banks order by allocation and pounds, not by specific item.**
  ([BRAFB ordering policy](https://www.brafb.org/wp-content/uploads/2025/02/BRAFB-Food-Ordering-Policy-Update-4.1.2025.pdf))
- **Shoppers accept familiar substitutes.** Products bought before are much more likely
  to be accepted as substitutes.
  ([Journal of Retailing, 2023](https://www.sciencedirect.com/science/article/pii/S002243592200046X)) [S]

### Units

- **US hubs trade in pounds, cases and bunches, and pack sizes vary by crop and buyer.**
  ([UC SAREP pack guide](https://sarep.ucdavis.edu/sites/g/files/dgvnsk5751/files/inline-files/INFOSHEET_ProducePackGuide.pdf);
  [WSDA pack table](https://cms.agr.wa.gov/WSDAKentico/farm-to-school/7-2_WA-grown_Fruit_Pack_Size_Table_1.pdf))

### AI risk

- **Numeric extraction is the weak spot.** The best model was 92.7% accurate on numeric
  fields, and most errors were format slips that rule-based validation catches
  ([arXiv 2601.09053](https://arxiv.org/pdf/2601.09053)) [S].
- **Reviewers miss AI errors.** Physicians scored 73.3% with flawed suggestions against
  84.9% with correct ones
  ([medRxiv 2025](https://www.medrxiv.org/content/10.1101/2025.08.23.25334280)) [S].
- **Generic warnings backfire.** Generic "check for errors" instructions increased
  acceptance of wrong suggestions ([arXiv 2509.08514](https://arxiv.org/abs/2509.08514)) [S].
- **Untested here:** nothing is published for informal grower texts or for Muse Spark.

### What can be claimed as impact

- **Claimable:** outputs a pilot can measure:
  - shortfalls caught before packing;
  - time from a grower's message to the buyer's notice;
  - shortfalls covered rather than shipped short;
  - re-keying avoided.
- **Not claimable:** tonnes of food saved, or health effects. Unharvested produce
  ([ReFED](https://refed.org/uploads/by-sector-farm-1.pdf), about 14M tons) [S] has mixed
  causes, and no source assigns any share of it to missed communication.

## Decision register

**Verdicts:**
- **Supported:** the evidence points the same way.
- **Contradicted:** the evidence points against the decision as first drafted.
- **Assumption:** no evidence either way. It needs a coordinator interview (Q-numbers
  below).

**Response** says what the design does about it.

| # | Decision | Verdict | Response |
|---|---|---|---|
| E1 | The model reads grower messages into a proposed change, with quoted evidence | Supported; channel caveat | Keep. Add **Log a call**: the coordinator's note of a phone call becomes a message the model reads, because phone dominates. |
| E2 | Approval is blocked while pack, unit or total-versus-added is unresolved | Supported | Keep |
| E3 | Detect which buyer orders a supply cut makes short | Supported | Core of story 1 |
| E4 | Three resolutions: ask a grower, offer a substitute, notify short | Supported | Keep |
| E5 | Ask only growers who already hold a lot of the product | Contradicted | Ask any member grower or outside source. A yes from someone with no lot is recorded by the coordinator as a new lot, with evidence. |
| E6 | Telling the buyer resolves the order | Supported | Keep. The order sheet shows the short so a credit can follow; credits are out of scope. |
| E7 | Substitute offers come only from unallocated confirmed supply on the same date and unit | Assumption (Q7) | Keep |
| E8 | No substitute without the buyer's consent | Supported for schools and restaurants. Contradicted as the only form: food banks and boxes give standing consent | Two forms. Per-order consent comes from a recorded reply. Standing permission on file (`approvedSubstitutions`) is shown with where it came from. |
| E9 | The coordinator records buyer replies, with a quote as evidence | Supported; quote requirement contradicted for phone replies | A reply can be a quoted text or a call note |
| E10 | The model drafts outgoing messages | Assumption (Q9) | Fixed templates are the default. **Draft with Muse Spark** is optional, and every draft goes through the checker. |
| E11 | Drafts are checked deterministically against the decision | Supported | Keep. It also checks the coordinator's own edits. |
| E12 | An edit that fails the check warns but does not block | Assumption (Q9) | Keep. Emptiness and the length limit still block. |
| E13 | An outbox only, with no real delivery | Demo only | Keep for the hackathon. Real delivery is a later milestone and needs credentials. |
| E14 | Grower replies go through normal review | Supported | Keep |
| E15 | Allocation by priority, then order ID | Assumption (Q5) | Keep, and show the rule in the UI so the coordinator can see it |
| E16 | An accepted substitute stales open reviews | Internal consistency | Keep |
| E17 | A packing lock that lapses on any change | Supported | Keep |
| E18 | The lock is blocked until every short order is resolved | Contradicted by timing: packing starts within hours | Unresolved orders block **unless** the coordinator chooses **Ship short**. The choice is recorded, and the sheets mark "buyer not told". |
| E19 | Printable pick lists and order sheets | Supported, but every platform has them | Keep. The value is that they match the locked plan. |
| E20 | Short orders appear in "Needs your attention" with actions | Supported (weak) | Keep |
| E21 | Surplus actions out of scope | Contradicted in emphasis | Deferred for time, not because surplus matters less (Q13) |
| E22 | The demo buyers | Schools and restaurants supported; deli weak | The deli becomes a community food pantry with standing substitute permission, showing both forms of consent |
| E23 | Demo quantities in kilograms | Contradicted for US hubs | Add pounds as a unit, and move the demo to pounds and cases |
| E24 | Impact claims | Only measurable outputs are supported | Show measured outputs in the app; claim no tonnes saved |

## Open questions for coordinator interviews

| Q | Question | Rows |
|---|---|---|
| Q1 | In a peak-season week, how many order lines are shorted or changed after cutoff? | E3 |
| Q2 | How much coordinator time does one shortfall take, from first message to corrected packing sheet? | E3, E10 |
| Q3 | What share of growers' in-week changes arrive by phone, text, email or portal? | E1 |
| Q4 | When short, who do you call first: the grower with the product, another member, an outside farm, or a distributor? | E5 |
| Q5 | Who gets shorted first when supply cannot cover every order, and is that rule written down? | E15 |
| Q6 | Which buyers need consent for each substitute, which have standing permission, and how is consent given? | E8, E9 |
| Q7 | How do you choose a substitute product? | E7 |
| Q8 | How late can a school kitchen or restaurant accept a short or substitute notice? Would you pack while a buyer hasn't answered? | E18 |
| Q9 | Would you send a model-drafted text, write it yourself, or use a template? | E10, E12 |
| Q10 | What happens to a short on the invoice? | E6 |
| Q11 | Can you share real grower messages ("four cases", "20ish flats") for an evaluation set? | E1, E2 |
| Q12 | Which platform do you use, and where do its shortage and packing workflows break? | E3, E19 |
| Q13 | Which is more frequent and costly in-week, surplus or shortage? | E21 |
| Q14 | Who are your buyers now that LFPA and LFS are gone, and what units do they order in? | E22, E23 |
| Q15 | What would you pay per month, and from which budget? | all |
