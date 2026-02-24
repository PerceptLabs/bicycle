# NanoCycle Prompt Regression Suite

Sync contract:
- Runtime guidance source is `src/prompts/designGuide.ts`.
- This suite mirrors expected outcomes and known regressions.
- Update this file when guidance behavior targets change.

## Purpose
Catch quality drift in prompt behavior, especially:
- overly white/flat outputs with little character
- transparent/unreadable cart fly-in or panel surfaces
- bland CTA treatment with weak visual hierarchy

All checks are manual and non-blocking.

## Execution Flow Assumptions
- Builder runs one full pass plus an optional syntax-heal retry (max 2 passes).
- Streaming should show live draft/token flow and step timeline.
- Theme/readability/syntax diagnostics are non-blocking visibility signals.

## Canonical Shopping Prompts

### 1) Short Variant
Prompt:
`Build a modern healthy drink shop with a small cart fly-in from the right.`

Expected outcomes:
- At least one clear accent region.
- Product cards and base page are visually layered.
- Cart fly-in remains readable and visually separated.

Watch regressions:
- Flat white everywhere with weak hierarchy.
- Transparent cart panel over content.
- CTA lacks clear visual emphasis.

Checklist:
- [ ] Multiple surface layers are visible.
- [ ] CTA is distinct with clear hover/active feedback.
- [ ] Cart panel text is readable at a glance.

### 2) Detailed Variant
Prompt:
`Create a polished ecommerce site for a cozy tea and comfort drink brand: 12 products, category filters, and a shopping cart fly-in drawer from the right. Keep it professional, distinctive, and readable.`

Expected outcomes:
- Strong section structure (hero, catalog, supporting trust/proof area).
- Readable product hierarchy (name, description, price, action).
- Cart drawer with explicit surface/background and clear separation.

Watch regressions:
- Generic washed-out layout with no emphasis.
- Drawer/modal style too transparent to read.
- Inconsistent button state styling.

Checklist:
- [ ] Layout has structured section rhythm.
- [ ] Price/action zones are easy to scan.
- [ ] Cart drawer has explicit readable surface and border/elevation.

### 3) Refinement Follow-up Variant
Prompt sequence:
1. Use detailed variant prompt above.
2. Follow-up: `Make it fresher and more impactful, but keep the same brand and cart behavior.`

Expected outcomes:
- Concept/domain continuity preserved.
- Style evolves without flattening contrast or losing readability.
- Cart affordance and readability remain intact.

Watch regressions:
- Unrelated concept switch.
- Loss of cart readability after refinement.
- Contrast hierarchy collapse into flat white.

Checklist:
- [ ] Concept remains shopping/cart-focused.
- [ ] Contrast hierarchy remains strong after refinement.
- [ ] Cart surface remains readable and usable.

## Troubleshooting

Symptom:
Output looks very white/flat with little character.

Mitigation prompt add-on:
`Use layered surfaces, elevated cards, one accent band, and stronger CTA contrast.`

Symptom:
Cart fly-in panel is transparent/hard to read over page content.

Mitigation prompt add-on:
`Make the cart use an explicit readable surface with clear background, border/elevation, and high text contrast.`

## Suggested Review Cadence
- Run this suite after major guidance changes.
- Spot check at least one local model and one cloud model.
- Log regressions in diagnostics notes with prompt used and screenshot.
- Verify behavior both inside embedded preview and direct `/preview/<project>/index.html`.
