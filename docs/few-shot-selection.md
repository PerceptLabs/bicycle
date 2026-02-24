# NanoCycle Few-Shot Selection

## Purpose
Improve visual variety and code reliability without adding runtime gates.

The selector injects compact, curated examples into prompt context as **patterns**.
It does not enforce generated output or block saves.

## Source Files
- Example bank: `src/prompts/exampleBank.ts`
- Selector: `src/prompts/shotSelector.ts`
- Loop integration: `src/loop.ts`

## Selection Algorithm
1. Infer request archetype from user prompt.
2. Score examples by:
   - archetype match
   - tag overlap with prompt intent
   - commerce cue relevance
   - quality rating
3. Apply reliability weighting:
   - if diagnostics include syntax/runtime failure signals, boost reliability examples
   - reduce design weighting when reliability risk is elevated
4. Diversity pass:
   - randomized ranking inside top candidates
   - select at most one example per pattern group
5. Budget pass:
   - hard cap on total shots and total prompt characters

## Defaults
- Mode: `reliability-first`
- Max shots: `4`
- Default split:
  - clean run: 2 reliability + 2 design
  - reliability incident: 3 reliability + 1 design
- Character budget for shot block: `3200`
- Snippet cap per example section: `380`

## Failure Handling
- If few-shot selection yields fewer examples due to budget/group limits, proceed with fewer examples.
- If no examples are selected, generation still proceeds using core prompt + diagnostics + guidance.
- Few-shot failures are non-blocking.

## Tuning Knobs
- `MAX_TOTAL_SHOTS`
- `MAX_TOTAL_CHARS`
- `MAX_SNIPPET_CHARS`
- reliability/design target counts by mode
- scoring weights for archetype, tag overlap, reliability boost

## Observability
Loop emits shot metadata for debugging:
- `shotIds`
- `shotSummary`
- action/artifact message with counts + seed summary

This allows debugging prompt quality drift without adding UI complexity.
