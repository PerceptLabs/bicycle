import {
  initProjectWorkspace,
  initWorkspace,
  listProjectFilesDeep,
  readProjectFile,
  writeProjectFile
} from './core/fs';
import { commitAllDurable, initRepo } from './core/git';
import { getCurrentProjectId } from './core/projects';
import {
  generateAppFromEndpoint,
  type GenerationResult
} from './utils/ai';
import { addDiagnostic, getDiagnosticsSummaryForPrompt, getLatestSyntaxFailureContext } from './core/diagnostics';
import { injectPreviewBridge } from './core/previewBridge';
import {
  analyzeReadabilityRisks,
  type ReadabilityRisk,
  validateJsSyntax,
  validateThemeContract
} from './utils/qualitySignals';
import {
  buildProjectThemeName,
  getProjectStyleProfile,
  inferPaletteFromPrompt,
  setProjectStyleProfile
} from './core/styleProfile';
import { buildDesignGuidanceBlock, inferDesignArchetype } from './prompts/designGuide';
import { selectPromptShots } from './prompts/shotSelector';
import { BUILDER_AGENT_NAME } from './config/brand';

const MAX_INTERNAL_ITERATIONS = 1;
const NARRATIVE_BLOCKLIST = ['awesome', 'elite', 'killer', "let's crush", 'legendary', 'insane'];

/**
 * Triggers a reload of all connected preview iframes.
 */
export function triggerPreviewReload() {
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'RELOAD_PREVIEW' });
  }
}

function notifyWorkspaceChanged() {
  window.dispatchEvent(new Event('workspace:changed'));
}

const SYSTEM_PROMPT = `You are ${BUILDER_AGENT_NAME}, a pragmatic front-end architect.

You generate complete, production-ready web experiences from user requests.
Do not output marketing copy or hype language in system-facing text.

Output contract (strict):
- Respond with valid JSON only.
- Return required top-level keys: "html" and "js".
- Do not return markdown or explanations.

Files contract:
- Return required top-level keys: "html" and "js".
- You may include optional "files" for split output.
- Prefer placing optional files under app/** for clean project structure.
- Keep app.js as the browser entrypoint; it may import local modules (for example ./app/main.js).
- Do not reference paths outside the project (no ../ traversal).

Core principles:
- Build complete experiences, not fragments.
- Choose the right scope for the request (landing page, mini-site, app flow, dashboard, storefront, etc.).
- Prefer clean component structure and reusable sections.
- Keep code lean and understandable, but avoid barebones/skeleton output unless explicitly requested.
- Avoid generic boilerplate styling and template-like layouts.

Design expectations:
- Strong visual hierarchy and clear section rhythm.
- Confident typography scale and spacing.
- Cohesive color system driven by project theme tokens.
- Primary actions must be visually clear with meaningful hover/active/focus-visible states.
- Body text and CTA text must maintain practical readability against their backgrounds.
- Button labels must remain readable in default, hover, and active states.
- Avoid low-opacity text for primary content and key controls.
- Critical surfaces (drawer/modal/cart/panel) must remain readable and clearly separated from background content.
- Avoid washed-out, flat-white outputs unless explicitly requested.

Architecture and behavior:
- Use Preact functional components and hooks where needed.
- Keep concerns separated (layout/sections/components/state).
- UI must be functional and stateful where product intent requires it.
- Interactions must work as rendered.
- Code must run directly in browser ESM context.

Hard HTML requirements:
1. Return a complete HTML5 document.
2. Include Tailwind CSS and DaisyUI via CDN.
3. Include a root node: <div id="app"></div>.
4. Load JS via <script type="module" src="./app.js"></script>.
5. Set a custom project theme name on <html data-theme="..."> (not just "light" or "dark").
6. Define required theme tokens for that theme: --p, --pf, --s, --sf, --a, --af, --b1, --b2, --bc.

Hard JS requirements:
1. Use modern ES modules.
2. Import { h, render } from 'https://esm.sh/preact@10.19.6'.
3. Import hooks from 'https://esm.sh/preact@10.19.6/hooks'.
4. Import htm from 'https://esm.sh/htm@3.1.1' and bind with: const html = htm.bind(h);
5. Render into document.getElementById('app').
6. Use DaisyUI as the primary UI system.
7. app.js must boot as a valid entrypoint; split builds should import local modules with explicit paths/extensions.`;

export type LoopUpdateType = 'status' | 'step' | 'token' | 'iteration' | 'final';
export type LoopUpdateChannel = 'narrative' | 'action' | 'artifact';

export interface LoopUpdateEvent {
  type: LoopUpdateType;
  channel?: LoopUpdateChannel;
  message?: string;
  token?: string;
  tokenCount?: number;
  step?: string;
  iteration?: number;
  totalIterations?: number;
  splitFallbackUsed?: boolean;
  shotIds?: string[];
  shotSummary?: string;
}

function emit(update: (event: LoopUpdateEvent) => void, event: LoopUpdateEvent) {
  update({
    channel: 'action',
    ...event
  });
}

function getSnippetFromCode(code: string, centerLine?: number, radius = 7): string {
  const lines = code.split(/\r?\n/);
  const safeCenter = typeof centerLine === 'number' ? Math.max(1, Math.min(centerLine, lines.length)) : 1;
  const start = Math.max(1, safeCenter - radius);
  const end = Math.min(lines.length, safeCenter + radius);
  const excerpt: string[] = [];
  for (let lineNo = start; lineNo <= end; lineNo++) {
    const marker = lineNo === safeCenter ? '>' : ' ';
    excerpt.push(`${marker} ${String(lineNo).padStart(4, ' ')} | ${lines[lineNo - 1]}`);
  }
  return excerpt.join('\n');
}

function sanitizeNarrative(message: string): string {
  let out = message;
  for (const banned of NARRATIVE_BLOCKLIST) {
    const regex = new RegExp(banned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
    out = out.replace(regex, '');
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}

type NarrativeStage =
  | 'start'
  | 'iteration_start'
  | 'inference_failed'
  | 'app_syntax_failed'
  | 'module_syntax_failed'
  | 'iteration_valid'
  | 'saving'
  | 'final_success';

function buildNarrativeMessage(stage: NarrativeStage, context: Record<string, string | number> = {}): string {
  const raw = (() => {
    switch (stage) {
      case 'start':
        return 'Reviewing your project and preparing a new pass.';
      case 'iteration_start':
        return `Drafting pass ${context.iteration || 1} of ${context.total || MAX_INTERNAL_ITERATIONS}.`;
      case 'inference_failed':
        return `Pass ${context.iteration || '?'} hit an inference error. Continuing with the next pass.`;
      case 'app_syntax_failed':
        return `Found a syntax issue at ${context.location || '/app.js'}. Retrying with focused fixes.`;
      case 'module_syntax_failed':
        return `Found a module syntax issue at ${context.location || '/app/main.js'}. Retrying with focused fixes.`;
      case 'iteration_valid':
        return `Pass ${context.iteration || '?'} is valid. ${context.next || 'Continuing optimization.'}`;
      case 'saving':
        return 'Applying the best candidate to your workspace.';
      case 'final_success':
        return `Applied pass ${context.iteration || '?'} with ${context.fileCount || '?'} files.`;
      default:
        return 'Updating build state.';
    }
  })();
  return sanitizeNarrative(raw);
}

function countWordTokens(input: string): number {
  const trimmed = input.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

async function loadProjectFilesMap(projectId: string): Promise<Map<string, string>> {
  const files = await listProjectFilesDeep(projectId);
  const fileMap = new Map<string, string>();
  for (const file of files) {
    const path = `/${file}`;
    fileMap.set(path, await readProjectFile(path, projectId));
  }
  return fileMap;
}

function renderProjectContextFromMap(files: Map<string, string>, maxCharsPerFile = 20000): string {
  const paths = Array.from(files.keys())
    .filter(path => !path.split('/').some(part => part.startsWith('.')))
    .sort((a, b) => {
      const pri = (file: string) => (file === '/index.html' ? 0 : file === '/app.js' ? 1 : 2);
      const pa = pri(a);
      const pb = pri(b);
      if (pa !== pb) return pa - pb;
      return a.localeCompare(b);
    });

  if (paths.length === 0) return 'No files found in the project workspace.';

  const chunks: string[] = [];
  for (const path of paths) {
    const raw = files.get(path) || '';
    const truncated = raw.length > maxCharsPerFile
      ? `${raw.slice(0, maxCharsPerFile)}\n/* truncated */`
      : raw;
    const ext = path.toLowerCase();
    const lang = ext.endsWith('.html')
      ? 'html'
      : ext.endsWith('.js')
        ? 'js'
        : ext.endsWith('.css')
          ? 'css'
          : ext.endsWith('.json')
            ? 'json'
            : '';
    chunks.push(`File: ${path.replace(/^\//, '')}\n\`\`\`${lang}\n${truncated}\n\`\`\``);
  }

  return chunks.join('\n\n');
}

interface HtmlBootContractResult {
  ok: boolean;
  missing: string[];
}

function validateHtmlBootContract(html: string): HtmlBootContractResult {
  const missing: string[] = [];
  if (!/<div[^>]*id=["']app["'][^>]*>/i.test(html)) {
    missing.push('<div id="app">');
  }
  if (!/<script[^>]*type=["']module["'][^>]*src=["']\.\/app\.js["'][^>]*>/i.test(html)) {
    missing.push('<script type="module" src="./app.js">');
  }
  return {
    ok: missing.length === 0,
    missing
  };
}

function summarizeRisks(risks: ReadabilityRisk[]): string {
  if (risks.length === 0) return 'No readability risks detected.';
  return risks
    .map(risk => `${risk.code}: ${risk.message}${risk.evidence ? ` (${risk.evidence})` : ''}`)
    .join('\n');
}

const MAX_EXTRA_GENERATED_FILES = 8;
const ALLOWED_EXTRA_EXTENSIONS = new Set(['js', 'mjs', 'css', 'json', 'svg', 'txt', 'md', 'html']);

interface NormalizedExtraFile {
  path: string;
  content: string;
}

interface NormalizedOutput {
  entryJs: string;
  extraFiles: NormalizedExtraFile[];
  splitFallbackUsed: boolean;
  warnings: string[];
}

function normalizeExtraFilePath(input: string): string | null {
  const normalized = input
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '');

  if (!normalized) return null;
  if (normalized.includes('..')) return null;
  if (normalized === 'index.html' || normalized === 'app.js') return null;
  if (normalized.split('/').some(part => !part || part === '.' || part.startsWith('.'))) return null;

  const ext = normalized.split('.').pop()?.toLowerCase();
  if (!ext || !ALLOWED_EXTRA_EXTENSIONS.has(ext)) return null;

  return `/${normalized}`;
}

function normalizeGeneratedOutput(generated: GenerationResult): NormalizedOutput {
  const warnings: string[] = [];
  const deduped = new Map<string, string>();

  if (Array.isArray(generated.files)) {
    for (const file of generated.files.slice(0, MAX_EXTRA_GENERATED_FILES)) {
      const normalizedPath = normalizeExtraFilePath(file.path);
      if (!normalizedPath) {
        warnings.push(`Skipped unsafe or unsupported file path: ${file.path}`);
        continue;
      }
      deduped.set(normalizedPath, file.content);
    }
    if (generated.files.length > MAX_EXTRA_GENERATED_FILES) {
      warnings.push(`Ignored ${generated.files.length - MAX_EXTRA_GENERATED_FILES} extra file(s) over the ${MAX_EXTRA_GENERATED_FILES}-file limit.`);
    }
  }

  let entryJs = generated.js;
  let splitFallbackUsed = false;

  if (deduped.size === 0) {
    deduped.set('/app/main.js', generated.js);
    entryJs = `import './app/main.js';\n`;
    splitFallbackUsed = true;
    warnings.push('Applied split fallback: moved generated app logic into /app/main.js with thin /app.js entrypoint.');
  }

  const extraFiles = Array.from(deduped.entries()).map(([path, content]) => ({ path, content }));
  return { entryJs, extraFiles, splitFallbackUsed, warnings };
}

let bootstrapPromise: Promise<void> | null = null;

/**
 * The Iteration Loop engine.
 */
export interface IterationLoopResult {
  ok: boolean;
  error?: string;
  appliedIteration?: number;
  riskCount?: number;
}

export async function runIterationLoop(prompt: string, update: (event: LoopUpdateEvent) => void): Promise<IterationLoopResult> {
  try {
    await initializeEditorLoop();
    const projectId = getCurrentProjectId();
    await initProjectWorkspace(projectId);

    emit(update, { type: 'status', channel: 'narrative', message: buildNarrativeMessage('start') });
    emit(update, { type: 'status', channel: 'action', message: 'Reading current project files...' });

    const diagnosticsSummary = getDiagnosticsSummaryForPrompt(projectId, 6);
    const latestSyntaxContext = await getLatestSyntaxFailureContext(projectId, 7);
    const existingStyleProfile = getProjectStyleProfile(projectId);
    const inferredStyle = inferPaletteFromPrompt(prompt, existingStyleProfile);
    const styleProfile = {
      projectId,
      themeName: existingStyleProfile?.themeName || buildProjectThemeName(projectId),
      mode: inferredStyle.mode,
      palette: inferredStyle.palette,
      updatedAt: new Date().toISOString(),
      source: inferredStyle.source
    };

    const styleTokenPreview = [
      `--p: ${styleProfile.palette.p};`,
      `--pf: ${styleProfile.palette.pf};`,
      `--s: ${styleProfile.palette.s};`,
      `--sf: ${styleProfile.palette.sf};`,
      `--a: ${styleProfile.palette.a};`,
      `--af: ${styleProfile.palette.af};`,
      `--b1: ${styleProfile.palette.b1};`,
      `--b2: ${styleProfile.palette.b2};`,
      `--bc: ${styleProfile.palette.bc};`
    ].join('\n');

    const designGuidance = buildDesignGuidanceBlock(prompt);
    const archetype = inferDesignArchetype(prompt);
    const selectedShots = selectPromptShots({
      userPrompt: prompt,
      diagnosticsSummary,
      latestSyntaxContext,
      archetype,
      mode: 'reliability-first',
      projectId
    });
    const workingSet = await loadProjectFilesMap(projectId);
    const iteration = 1;
    let streamedTokenCount = 0;

    emit(update, {
      type: 'iteration',
      channel: 'action',
      iteration,
      totalIterations: MAX_INTERNAL_ITERATIONS,
      message: `Iteration ${iteration}/${MAX_INTERNAL_ITERATIONS}`
    });
    emit(update, {
      type: 'status',
      channel: 'narrative',
      message: buildNarrativeMessage('iteration_start', {
        iteration,
        total: MAX_INTERNAL_ITERATIONS
      })
    });
    emit(update, {
      type: 'step',
      channel: 'artifact',
      step: 'shots',
      iteration,
      totalIterations: MAX_INTERNAL_ITERATIONS,
      message: `Shot selection: ${selectedShots.summary}`,
      shotIds: selectedShots.shotIds,
      shotSummary: selectedShots.reasons.join('; ')
    });

    const modelCallbacks = {
      onPhase: (message: string) => emit(update, {
        type: 'step',
        channel: 'action',
        step: 'inference',
        iteration,
        totalIterations: MAX_INTERNAL_ITERATIONS,
        message
      }),
      onToken: (token: string) => {
        streamedTokenCount += countWordTokens(token);
        emit(update, {
          type: 'token',
          channel: 'artifact',
          token,
          tokenCount: streamedTokenCount,
          iteration,
          totalIterations: MAX_INTERNAL_ITERATIONS
        });
      },
      onComplete: (finalText: string) => {
        if (streamedTokenCount === 0 && finalText) {
          streamedTokenCount += countWordTokens(finalText);
          emit(update, {
            type: 'token',
            channel: 'artifact',
            token: finalText,
            tokenCount: streamedTokenCount,
            iteration,
            totalIterations: MAX_INTERNAL_ITERATIONS
          });
        }
        emit(update, {
          type: 'step',
          channel: 'action',
          step: 'inference',
          iteration,
          totalIterations: MAX_INTERNAL_ITERATIONS,
          message: 'Model response completed.'
        });
      }
    };

    const contextualPrompt = `Project ID: ${projectId}

User request:
${prompt}

Current project files:
${renderProjectContextFromMap(workingSet, 12000)}

Recent runtime diagnostics:
${diagnosticsSummary}

Latest syntax failure context:
${latestSyntaxContext}

Brand style profile:
Theme name: ${styleProfile.themeName}
Preferred mode: ${styleProfile.mode}
Palette seed:
${styleTokenPreview}

Design guidance modules:
${designGuidance}

${selectedShots.promptBlock}

Instruction:
Return updated index.html and app.js for this project.
Prefer split output with optional files[] under app/** when appropriate.
Keep app.js as the entrypoint and import local modules with explicit relative paths.
Use selected examples as patterns; do not copy snippets literally.
Ensure all referenced local files are included in files[].`;

    let generated: GenerationResult;
    try {
      generated = await generateAppFromEndpoint(contextualPrompt, SYSTEM_PROMPT, modelCallbacks);
    } catch (genError: any) {
      addDiagnostic({
        projectId,
        source: 'builder',
        level: 'error',
        errorKind: 'other',
        message: 'Inference failed',
        details: genError?.message || 'Unknown inference failure.'
      });
      emit(update, {
        type: 'final',
        channel: 'narrative',
        message: buildNarrativeMessage('inference_failed', { iteration })
      });
      return {
        ok: false,
        error: genError?.message || 'Model output could not be parsed.'
      };
    }

    const candidateHtml = generated.html;
    const normalizedOutput = normalizeGeneratedOutput(generated);
    for (const warning of normalizedOutput.warnings) {
      addDiagnostic({
        projectId,
        source: 'builder',
        level: 'warn',
        errorKind: 'other',
        message: 'Generated file normalization',
        details: warning
      });
    }

    const candidateEntryJs = normalizedOutput.entryJs;
    const jsCandidates = [
      { path: '/app.js', code: candidateEntryJs },
      ...normalizedOutput.extraFiles
        .filter(file => file.path.toLowerCase().endsWith('.js') || file.path.toLowerCase().endsWith('.mjs'))
        .map(file => ({ path: file.path, code: file.content }))
    ];
    const readabilityInputJs = [candidateEntryJs, ...normalizedOutput.extraFiles.map(file => file.content)].join('\n\n');
    const readabilityRisks = analyzeReadabilityRisks(candidateHtml, readabilityInputJs);
    const themeContract = validateThemeContract(candidateHtml);
    const bootContract = validateHtmlBootContract(candidateHtml);

    emit(update, {
      type: 'step',
      channel: 'artifact',
      iteration,
      totalIterations: MAX_INTERNAL_ITERATIONS,
      message: `Structured payload: index.html + app.js + ${normalizedOutput.extraFiles.length} extra file(s).`,
      tokenCount: streamedTokenCount,
      splitFallbackUsed: normalizedOutput.splitFallbackUsed
    });
    emit(update, {
      type: 'step',
      channel: 'action',
      step: 'validation',
      iteration,
      totalIterations: MAX_INTERNAL_ITERATIONS,
      message: 'Checking generated output...'
    });

    for (const candidate of jsCandidates) {
      const syntaxPreflight = validateJsSyntax(candidate.code);
      if (syntaxPreflight.ok) continue;
      const syntaxSnippet = getSnippetFromCode(candidate.code, syntaxPreflight.line, 7);
      addDiagnostic({
        projectId,
        source: 'builder',
        level: 'error',
        errorKind: 'syntax',
        message: `Generated JS syntax issue @ ${candidate.path}`,
        details: `${syntaxPreflight.message || 'Invalid JavaScript syntax.'}\n\n${syntaxSnippet}`,
        filePath: candidate.path,
        line: syntaxPreflight.line,
        column: syntaxPreflight.column
      });
    }

    if (readabilityRisks.length > 0) {
      addDiagnostic({
        projectId,
        source: 'builder',
        level: 'warn',
        errorKind: 'other',
        message: 'Readability risks detected (iteration 1)',
        details: summarizeRisks(readabilityRisks)
      });
    }

    if (!themeContract.ok) {
      addDiagnostic({
        projectId,
        source: 'builder',
        level: 'warn',
        errorKind: 'other',
        message: 'Theme contract warning (iteration 1)',
        details: `Reason: ${themeContract.reason || 'Theme contract is incomplete.'}\nMissing tokens: ${themeContract.missing.join(', ') || 'none'}`
      });
    }

    if (!bootContract.ok) {
      addDiagnostic({
        projectId,
        source: 'builder',
        level: 'warn',
        errorKind: 'other',
        message: 'Boot contract warning (iteration 1)',
        details: `Missing required HTML boot contract elements: ${bootContract.missing.join(', ')}`
      });
    }

    const finalHtml = candidateHtml;
    const finalEntryJs = candidateEntryJs;
    const finalExtraFiles = normalizedOutput.extraFiles;
    const finalTheme = validateThemeContract(finalHtml);
    setProjectStyleProfile(projectId, {
      ...styleProfile,
      themeName: finalTheme.themeName || styleProfile.themeName,
      source: styleProfile.source
    });

    emit(update, {
      type: 'status',
      channel: 'narrative',
      message: buildNarrativeMessage('saving')
    });
    emit(update, { type: 'step', channel: 'action', step: 'save', message: 'Applying update...' });

    const instrumentedHtml = injectPreviewBridge(finalHtml);
    const currentFiles = await loadProjectFilesMap(projectId);
    const pendingWrites: Array<{ path: string; content: string }> = [];

    if (currentFiles.get('/index.html') !== instrumentedHtml) {
      pendingWrites.push({ path: '/index.html', content: instrumentedHtml });
    }
    if (currentFiles.get('/app.js') !== finalEntryJs) {
      pendingWrites.push({ path: '/app.js', content: finalEntryJs });
    }
    for (const file of finalExtraFiles) {
      if (currentFiles.get(file.path) !== file.content) {
        pendingWrites.push({ path: file.path, content: file.content });
      }
    }
    for (const file of pendingWrites) {
      await writeProjectFile(file.path, file.content, projectId);
    }

    notifyWorkspaceChanged();

    if (pendingWrites.length > 0) {
      emit(update, {
        type: 'step',
        channel: 'action',
        step: 'reload',
        message: 'Refreshing preview...'
      });
      triggerPreviewReload();
      emit(update, {
        type: 'step',
        channel: 'action',
        step: 'reload',
        message: 'Preview reloaded.'
      });
    }

    emit(update, { type: 'step', channel: 'action', step: 'commit', message: 'Finalizing changes...' });

    const commitResult = await commitAllDurable(`Update: ${prompt}`);
    if (!commitResult.ok) {
      addDiagnostic({
        projectId,
        source: 'builder',
        level: 'warn',
        errorKind: 'other',
        message: 'Commit failed',
        details: commitResult.reason || 'Unknown commit error.'
      });
      emit(update, {
        type: 'step',
        channel: 'action',
        step: 'commit',
        message: 'Commit failed. Preview update continues.'
      });
    } else {
      if (commitResult.healed) {
        addDiagnostic({
          projectId,
          source: 'builder',
          level: 'warn',
          errorKind: 'other',
          message: 'Git auto-heal applied',
          details: 'Recovered from git object inconsistency and rebuilt metadata snapshot.'
        });
      }
      emit(update, {
        type: 'step',
        channel: 'action',
        step: 'commit',
        message: 'Commit completed.'
      });
    }

    emit(update, {
      type: 'final',
      channel: 'narrative',
      message: buildNarrativeMessage('final_success', {
        iteration: 1,
        fileCount: 2 + finalExtraFiles.length
      })
    });
    emit(update, {
      type: 'step',
      channel: 'artifact',
      message: `Final artifact metadata: pass=1, tokens=${streamedTokenCount}.`,
      iteration: 1,
      totalIterations: MAX_INTERNAL_ITERATIONS,
      tokenCount: streamedTokenCount,
      splitFallbackUsed: normalizedOutput.splitFallbackUsed
    });

    return {
      ok: true,
      appliedIteration: 1,
      riskCount: readabilityRisks.length
    };
  } catch (e: any) {
    const message = e?.message || 'Generation failed.';
    addDiagnostic({
      source: 'builder',
      level: 'error',
      message: 'Generation loop failed',
      details: message
    });
    emit(update, { type: 'final', channel: 'narrative', message: sanitizeNarrative(message) });
    return { ok: false, error: message };
  }
}

/**
 * Setup the initial workspace.
 */
export function initializeEditorLoop() {
  if (!bootstrapPromise) {
    bootstrapPromise = bootstrapWorkspace();
  }
  return bootstrapPromise;
}

async function bootstrapWorkspace() {
  await initWorkspace();
  try {
    await initRepo();
  } catch (e) {
    // Ignore if already initialized
  }
  try {
    await commitAllDurable('Initial commit: Workspace setup');
  } catch (e) {
    // Ignore if already initialized
  }
}
