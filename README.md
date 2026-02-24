# NanoCycle

NanoCycle is a lightweight, hackable AI builder for generating Preact + DaisyUI web apps with streaming updates, live preview, and file-based editing.

![NanoCycle](public/bicycle-animated.svg)

## Quick Start

```bash
npm install
npm run dev
```

Dev server default: `http://localhost:4500`

Production build:

```bash
npm run build
```

Bundle report:

```bash
npm run size:report
```

## What It Does

- Generates `index.html` + `app.js` with optional split files under `app/**`.
- Streams model output into the chat timeline.
- Captures runtime and builder diagnostics with shareable debug output.
- Supports incremental patch-mode edits with deterministic fallback to full generation.
- Exports the current project as a zip.
- Maintains durable git history in the in-browser workspace.

## Provider Setup

Configure in **Settings**:

- Ollama: `http://localhost:11434/v1`
- LM Studio: `http://localhost:1234/v1`
- OpenRouter: `https://openrouter.ai/api/v1`
- Any OpenAI-compatible endpoint

## Project Structure

- `src/loop.ts`: generation loop, prompt assembly, apply/commit pipeline.
- `src/utils/ai.ts`: inference client, streaming, structured parsing.
- `src/utils/patchOps.ts`: deterministic patch operation engine.
- `src/core/git.ts`: durable git orchestrator (lock/journal + worker RPC).
- `src/workers/gitWorker.ts`: git + LightningFS execution worker.
- `public/sw.js`: service worker for preview routing and VFS file serving.
- `scripts/sync-sw-vendor.mjs`: copies local LightningFS vendor file for SW.

## Troubleshooting

- `Inference provider timed out`:
  - verify endpoint/model in Settings
  - local providers may need CORS/proxy setup
- Preview blank or runtime error:
  - use **Copy Debug** in chat panel
  - inspect browser console for the failing file/line
- Service worker issues:
  - reload once after updates
  - ensure `public/vendor/lightning-fs.min.js` exists (synced by predev/prebuild)

