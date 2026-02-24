# NanoCycle Loop Architecture

## Overview
NanoCycle runs a simple conversational generation loop per user prompt.
Each prompt runs one full generation pass and applies generated `index.html`, `app.js`, and optional split files.

## Loop Steps
1. Build contextual prompt from:
   - user request
   - current project files
   - recent diagnostics
   - style profile
   - modular design guidance
   - hybrid few-shot examples (reliability-first weighting)
2. Generate candidate (`index.html` + `app.js`, plus optional `files[]`) with streaming enabled.
3. Run diagnostics on candidate:
   - syntax checks for `app.js`
   - readability risk analysis
   - theme token checks
   - boot contract checks
4. Apply the candidate, write changed files, commit, and reload preview.

## Streaming Behavior
- Streaming requests use OpenAI-compatible SSE.
- UI receives:
  - token deltas
  - phase/step updates
  - iteration markers
- If streaming is unsupported, system falls back to non-streaming for that request mode.

## Safety Boundaries
- Parse/network failures can fail a run.
- Syntax/readability/theme/boot checks are diagnostics only and do not block apply.
- If generation response is not parseable, files are not overwritten.

## Few-Shot Selection
- Selector blends retrieval and light randomization from curated examples.
- Default bias is reliability-first; syntax/runtime diagnostics increase reliability weighting.
- Example block is bounded by shot count and character budget.
- Selector emits lightweight debug metadata (shot IDs + summary) into loop updates.

## Maintainer Notes
- Keep this doc aligned with `src/loop.ts` and `src/utils/ai.ts`.
- When changing loop limits or retry behavior, update docs and regression suite together.
