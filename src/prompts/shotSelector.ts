import { designExamples, reliabilityExamples, type PromptExample, type PromptShotArchetype } from './exampleBank';

export type ShotSelectionMode = 'reliability-first' | 'balanced';

export interface SelectPromptShotsInput {
    userPrompt: string;
    diagnosticsSummary: string;
    latestSyntaxContext: string;
    archetype: PromptShotArchetype;
    mode: ShotSelectionMode;
    projectId?: string;
}

export interface SelectedShots {
    selected: PromptExample[];
    shotIds: string[];
    counts: {
        design: number;
        reliability: number;
    };
    reasons: string[];
    summary: string;
    promptBlock: string;
    seed: number;
    totalChars: number;
}

interface ScoredExample {
    example: PromptExample;
    score: number;
    reasons: string[];
}

const MAX_TOTAL_SHOTS = 4;
const MAX_TOTAL_CHARS = 3200;
const MAX_SNIPPET_CHARS = 380;
const HYPE_WORDS = /\b(awesome|epic|killer|insane|legendary|blazing|mind[- ]blowing)\b/gi;

function xfnv1a(input: string): number {
    let hash = 2166136261;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return hash >>> 0;
}

function mulberry32(seed: number): () => number {
    let t = seed >>> 0;
    return () => {
        t += 0x6d2b79f5;
        let x = Math.imul(t ^ (t >>> 15), 1 | t);
        x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
}

function tokenize(text: string): string[] {
    return text.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
}

function truncateSnippet(input: string, maxChars = MAX_SNIPPET_CHARS): string {
    const trimmed = input.replace(/\s+/g, ' ').trim();
    if (trimmed.length <= maxChars) return trimmed;
    return `${trimmed.slice(0, maxChars - 1)}...`;
}

function sanitizeNote(input: string): string {
    return input.replace(HYPE_WORDS, '').replace(/\s{2,}/g, ' ').trim();
}

function hasReliabilitySignal(text: string): boolean {
    return /\b(syntax|referenceerror|typeerror|runtime|failed|unhandled|rendered empty|blank|unexpected token)\b/i.test(text);
}

function hasCommerceSignal(text: string): boolean {
    return /\b(shop|store|cart|checkout|product|catalog|buy|price)\b/i.test(text);
}

function countTagHits(example: PromptExample, promptTokens: Set<string>): number {
    let hits = 0;
    for (const tag of example.tags) {
        if (promptTokens.has(tag.toLowerCase())) {
            hits++;
        }
    }
    return hits;
}

function scoreExample(
    example: PromptExample,
    archetype: PromptShotArchetype,
    promptTokens: Set<string>,
    reliabilityIncident: boolean,
    commerceIntent: boolean,
    mode: ShotSelectionMode
): ScoredExample {
    let score = example.quality * 10;
    const reasons: string[] = [];

    if (example.archetype === archetype) {
        score += 22;
        reasons.push('archetype match');
    }

    const tagHits = countTagHits(example, promptTokens);
    if (tagHits > 0) {
        score += tagHits * 6;
        reasons.push(`tag overlap (${tagHits})`);
    }

    if (commerceIntent && example.domain.includes('commerce')) {
        score += 10;
        reasons.push('commerce cue');
    }

    if (reliabilityIncident) {
        if (example.kind === 'reliability') {
            score += mode === 'reliability-first' ? 30 : 18;
            reasons.push('reliability boost');
        } else {
            score -= mode === 'reliability-first' ? 8 : 4;
        }
    } else if (example.kind === 'reliability') {
        score += 6;
    }

    return { example, score, reasons };
}

function pickDiverse(
    scored: ScoredExample[],
    targetCount: number,
    rng: () => number,
    usedPatternGroups: Set<string>,
    remainingChars: number
): { picked: ScoredExample[]; usedChars: number } {
    if (targetCount <= 0 || scored.length === 0 || remainingChars <= 0) {
        return { picked: [], usedChars: 0 };
    }

    const poolSize = Math.min(scored.length, Math.max(targetCount * 4, targetCount));
    const jittered = scored
        .slice(0, poolSize)
        .map(item => ({ ...item, jitteredScore: item.score + rng() * 8 }))
        .sort((a, b) => b.jitteredScore - a.jitteredScore);

    const picked: ScoredExample[] = [];
    let usedChars = 0;

    for (const item of jittered) {
        if (picked.length >= targetCount) break;
        if (usedPatternGroups.has(item.example.patternGroup)) continue;

        const estimated = (
            truncateSnippet(item.example.htmlSnippet).length +
            truncateSnippet(item.example.jsSnippet).length +
            sanitizeNote(item.example.notes).length +
            120
        );
        if (usedChars + estimated > remainingChars && picked.length > 0) continue;

        picked.push(item);
        usedPatternGroups.add(item.example.patternGroup);
        usedChars += estimated;
    }

    return { picked, usedChars };
}

function formatShotForPrompt(item: ScoredExample): string {
    const html = truncateSnippet(item.example.htmlSnippet);
    const js = truncateSnippet(item.example.jsSnippet);
    const note = sanitizeNote(item.example.notes);
    const why = item.reasons.length > 0 ? item.reasons.join(', ') : 'general quality signal';

    return [
        `- [${item.example.id}] ${item.example.kind} | ${item.example.archetype} | ${item.example.domain}`,
        `  reason: ${why}`,
        `  html: ${html}`,
        `  js: ${js}`,
        `  note: ${note}`
    ].join('\n');
}

export function selectPromptShots(input: SelectPromptShotsInput): SelectedShots {
    const reliabilityIncident = hasReliabilitySignal(`${input.diagnosticsSummary}\n${input.latestSyntaxContext}`);
    const commerceIntent = hasCommerceSignal(input.userPrompt);
    const promptTokens = new Set(tokenize(input.userPrompt));
    const seed = xfnv1a(`${input.projectId || 'project'}|${input.userPrompt}|${input.diagnosticsSummary.slice(0, 180)}`);
    const rng = mulberry32(seed);

    const allDesign = designExamples
        .map(example => scoreExample(example, input.archetype, promptTokens, reliabilityIncident, commerceIntent, input.mode))
        .sort((a, b) => b.score - a.score);

    const allReliability = reliabilityExamples
        .map(example => scoreExample(example, input.archetype, promptTokens, reliabilityIncident, commerceIntent, input.mode))
        .sort((a, b) => b.score - a.score);

    let reliabilityTarget = 2;
    let designTarget = 2;
    if (input.mode === 'reliability-first' && reliabilityIncident) {
        reliabilityTarget = 3;
        designTarget = 1;
    }

    const usedPatternGroups = new Set<string>();
    let remainingChars = MAX_TOTAL_CHARS;
    const selected: ScoredExample[] = [];

    const reliabilityPick = pickDiverse(allReliability, reliabilityTarget, rng, usedPatternGroups, remainingChars);
    selected.push(...reliabilityPick.picked);
    remainingChars -= reliabilityPick.usedChars;

    const designPick = pickDiverse(allDesign, designTarget, rng, usedPatternGroups, remainingChars);
    selected.push(...designPick.picked);
    remainingChars -= designPick.usedChars;

    if (selected.length < MAX_TOTAL_SHOTS && remainingChars > 0) {
        const fallbackPool = [...allDesign, ...allReliability].sort((a, b) => b.score - a.score);
        const extra = pickDiverse(fallbackPool, MAX_TOTAL_SHOTS - selected.length, rng, usedPatternGroups, remainingChars);
        selected.push(...extra.picked);
        remainingChars -= extra.usedChars;
    }

    const limited = selected.slice(0, MAX_TOTAL_SHOTS);
    const shotIds = limited.map(item => item.example.id);
    const counts = {
        design: limited.filter(item => item.example.kind !== 'reliability').length,
        reliability: limited.filter(item => item.example.kind === 'reliability').length
    };

    const reasons = [
        `mode=${input.mode}`,
        reliabilityIncident ? 'reliability boost applied' : 'normal weighting',
        commerceIntent ? 'commerce cue applied' : 'no commerce boost',
        `archetype=${input.archetype}`
    ];

    const promptLines = [
        'Selected examples for this request (patterns only, do not copy literally):',
        ...limited.map(formatShotForPrompt),
        'Use these as structural/style/code reliability cues, not templates.'
    ];

    const promptBlockRaw = promptLines.join('\n');
    const promptBlock = promptBlockRaw.length > MAX_TOTAL_CHARS
        ? `${promptBlockRaw.slice(0, MAX_TOTAL_CHARS - 1)}...`
        : promptBlockRaw;

    return {
        selected: limited.map(item => item.example),
        shotIds,
        counts,
        reasons,
        summary: `shots=${limited.length}, reliability=${counts.reliability}, design=${counts.design}, seed=${seed}`,
        promptBlock,
        seed,
        totalChars: promptBlock.length
    };
}

