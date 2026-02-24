# NanoCycle Design Guidelines

Sync contract:
- Runtime source of truth lives in `src/prompts/designGuide.ts`.
- This document mirrors that guidance for review and maintenance.
- Update both files in the same PR when guidance changes.

## Purpose
These guidelines improve generated design quality through prompt engineering.
They are guidance rules, not runtime hard-gate validators.

## Prompt Architecture
- Use a slim core system prompt for hard runtime/output constraints.
- Inject guidance modules by intent:
  - base quality
  - archetype cues
  - commerce readability
  - refinement continuity
- Inject a compact hybrid few-shot block selected per request:
  - reliability examples (boot/import/render safety)
  - design examples (layout/theme/interaction variety)
- Avoid large monolithic rule blocks that overconstrain weaker models.
- Design guidance and diagnostics are advisory in the runtime apply path.

## Few-Shot Policy
- Use hybrid retrieval + light randomness, not pure random sampling.
- Prioritize reliability shots when recent diagnostics include syntax/runtime failures.
- Keep total few-shot payload bounded to prevent context bloat.
- Use examples as patterns, not templates; avoid literal copying.
- Keep one example per similar pattern group to preserve diversity.

## Visual Hierarchy
- Keep one clear hero message and one primary CTA.
- Use supporting secondary actions, not multiple competing primaries.
- Preserve a readable type ladder: `h1 > h2 > body > caption`.

## Spacing Rhythm
- Use an 8px-based spacing rhythm for section, card, and element spacing.
- Avoid cramped cards and uneven vertical gaps.

## Color and Token Usage
- Build colors from project theme tokens first.
- Avoid accidental fallback palette behavior.
- Keep CTA, hover, and active states in one brand family.
- Blue branding is allowed when explicitly requested.

## Contrast and Character Floor
- In light themes, maintain at least three visual layers:
  - base page surface
  - elevated card/surface layer
  - emphasized accent section
- Include at least one deliberate accent region (hero band, promo strip, highlighted block).
- Avoid full-page flat white output with no contrast hierarchy.
- Primary CTA should have non-flat treatment and clear hover/active difference.

## Critical Surface Readability
- Overlays, drawers, modals, and fly-in carts must use explicit readable surfaces.
- Avoid key text/actions on fully transparent containers over active content.
- If transparency is used, preserve readability with strong contrast and elevation.
- Use visible border/shadow/elevation separation for side panels and modal surfaces.

## Archetype Cues
Use prompt archetypes to tune tone without hardcoding one style:
- `energy`: bold, higher contrast, punchy hierarchy.
- `wellness/tea`: calm, breathable, softer visual rhythm.
- `saas/productivity`: structured, clear grouping, utility-forward.
- `editorial-modern`: content-forward, intentional typographic contrast.

### Commerce Cues
When request implies shopping/cart/checkout:
- Keep product hierarchy scannable (title, value, price, action).
- Keep cart affordance stable and easy to find.
- Keep price/action zones highly readable.
- Maintain readable surfaces for cart drawers/fly-ins.

## Refinement Continuity Rules
- Keep app concept/domain anchored on iterative prompts.
- Evolve style and quality rather than switching concepts.
- Preserve palette unless user explicitly asks for recolor/rebrand.
- Avoid reducing rich layouts into generic washed-out styles.

## Non-goals
- No design hard-gating in this guidance layer.
- No save blocking based on subjective design taste.
- No requirement to force one universal visual style.
- No forced \"single-page\" or forced interaction count bias.

## Maintainer Checklist
- Update `src/prompts/designGuide.ts` and this doc together.
- Re-run a quick regression prompt suite after guidance edits.
- Confirm commerce/cart readability remains clear in generated output.
