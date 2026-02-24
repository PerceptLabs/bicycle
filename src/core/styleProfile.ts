import { getCurrentProjectId } from './projects';

export interface ThemePalette {
    p: string;
    pf: string;
    s: string;
    sf: string;
    a: string;
    af: string;
    b1: string;
    b2: string;
    bc: string;
}

export interface ProjectStyleProfile {
    projectId: string;
    themeName: string;
    mode: 'light' | 'dark';
    palette: ThemePalette;
    updatedAt: string;
    source: 'persisted' | 'explicit' | 'semantic' | 'normalized';
}

export interface InferredPaletteResult {
    mode: 'light' | 'dark';
    palette: ThemePalette;
    source: 'persisted' | 'explicit' | 'semantic';
}

const STYLE_PROFILES_KEY = 'nanobuild-style-profiles';

const COLOR_HUES: Record<string, number> = {
    red: 4,
    orange: 26,
    amber: 40,
    yellow: 52,
    lime: 78,
    green: 142,
    emerald: 155,
    teal: 170,
    cyan: 188,
    sky: 202,
    blue: 220,
    indigo: 238,
    violet: 258,
    purple: 274,
    fuchsia: 305,
    pink: 332,
    rose: 350
};

function hashString(input: string): number {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
        hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
}

function readStore(): Record<string, ProjectStyleProfile> {
    const raw = localStorage.getItem(STYLE_PROFILES_KEY);
    if (!raw) return {};
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            return parsed as Record<string, ProjectStyleProfile>;
        }
    } catch {
        // Ignore malformed storage values.
    }
    return {};
}

function writeStore(store: Record<string, ProjectStyleProfile>) {
    localStorage.setItem(STYLE_PROFILES_KEY, JSON.stringify(store));
}

function sanitizeThemeName(input: string): string {
    const normalized = input
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '');
    if (!normalized) return 'project-theme';
    if (normalized === 'light' || normalized === 'dark') return `${normalized}-project`;
    return normalized;
}

function parseHue(token: string): number | null {
    const match = token.match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) return null;
    return ((Math.round(value) % 360) + 360) % 360;
}

function includesAny(haystack: string, needles: string[]): boolean {
    return needles.some(needle => haystack.includes(needle));
}

function detectExplicitMode(prompt: string): 'light' | 'dark' | null {
    const lower = prompt.toLowerCase();

    const explicitLight = [
        'light mode',
        'light theme',
        'bright',
        'airy',
        'sunny',
        'pastel',
        'daylight',
        'white background'
    ];
    const explicitDark = [
        'dark mode',
        'dark theme',
        'night mode',
        'noir',
        'midnight',
        'black background'
    ];

    if (includesAny(lower, explicitLight)) return 'light';
    if (includesAny(lower, explicitDark)) return 'dark';
    return null;
}

function inferMode(
    prompt: string,
    previousProfile: ProjectStyleProfile | null,
    explicitMode: 'light' | 'dark' | null
): 'light' | 'dark' {
    if (explicitMode) return explicitMode;
    const lower = prompt.toLowerCase();

    const lightHints = ['tea', 'wellness', 'cozy', 'spa', 'calm', 'sleep', 'organic', 'minimal'];
    const darkHints = ['energy drink', 'gaming', 'esports', 'cyber', 'futuristic', 'nightclub'];
    const lightScore = lightHints.reduce((sum, hint) => sum + (lower.includes(hint) ? 1 : 0), 0);
    const darkScore = darkHints.reduce((sum, hint) => sum + (lower.includes(hint) ? 1 : 0), 0);

    if (lightScore > darkScore) return 'light';
    if (darkScore > lightScore) return 'dark';
    return previousProfile?.mode || 'light';
}

function inferExplicitHue(prompt: string): number | null {
    const lower = prompt.toLowerCase();
    for (const [name, hue] of Object.entries(COLOR_HUES)) {
        const pattern = new RegExp(`\\b${name}\\b`, 'i');
        if (pattern.test(lower)) return hue;
    }
    return null;
}

function hasRebrandIntent(prompt: string): boolean {
    const lower = prompt.toLowerCase();
    const hints = [
        'rebrand',
        'new brand',
        'change color',
        'change palette',
        'new palette',
        'different palette',
        'switch color',
        'switch palette',
        'new theme'
    ];
    return includesAny(lower, hints);
}

function rotateHue(hue: number, amount: number): number {
    return (hue + amount + 360) % 360;
}

function buildPalette(hue: number, mode: 'light' | 'dark'): ThemePalette {
    const sHue = rotateHue(hue, 32);
    const aHue = rotateHue(hue, -28);

    if (mode === 'dark') {
        return {
            p: `${hue} 86% 64%`,
            pf: `${hue} 82% 56%`,
            s: `${sHue} 72% 60%`,
            sf: `${sHue} 68% 52%`,
            a: `${aHue} 74% 62%`,
            af: `${aHue} 70% 54%`,
            b1: `${rotateHue(hue, 8)} 18% 13%`,
            b2: `${rotateHue(hue, 8)} 16% 17%`,
            bc: `${rotateHue(hue, 8)} 22% 90%`
        };
    }

    return {
        p: `${hue} 76% 46%`,
        pf: `${hue} 78% 38%`,
        s: `${sHue} 64% 47%`,
        sf: `${sHue} 68% 39%`,
        a: `${aHue} 67% 49%`,
        af: `${aHue} 70% 41%`,
        b1: `${rotateHue(hue, 8)} 30% 98%`,
        b2: `${rotateHue(hue, 8)} 22% 93%`,
        bc: `${rotateHue(hue, 8)} 20% 18%`
    };
}

export function buildProjectThemeName(projectId: string = getCurrentProjectId()): string {
    return sanitizeThemeName(`${projectId}-brand`);
}

export function getProjectStyleProfile(projectId: string = getCurrentProjectId()): ProjectStyleProfile | null {
    const store = readStore();
    return store[projectId] || null;
}

export function setProjectStyleProfile(projectId: string, profile: ProjectStyleProfile): ProjectStyleProfile {
    const store = readStore();
    const next: ProjectStyleProfile = {
        ...profile,
        projectId,
        themeName: sanitizeThemeName(profile.themeName),
        updatedAt: new Date().toISOString()
    };
    store[projectId] = next;
    writeStore(store);
    return next;
}

export function inferPaletteFromPrompt(
    prompt: string,
    previousProfile?: ProjectStyleProfile | null
): InferredPaletteResult {
    const prior = previousProfile || null;
    const explicitMode = detectExplicitMode(prompt);
    const explicitHue = inferExplicitHue(prompt);
    const explicitRebrand = hasRebrandIntent(prompt);
    const mode = inferMode(prompt, prior, explicitMode);

    if (prior && explicitHue === null && !explicitRebrand && !explicitMode) {
        return {
            mode,
            palette: prior.palette,
            source: 'persisted'
        };
    }

    const priorHue = prior ? parseHue(prior.palette.p) : null;
    const baseHue = explicitHue
        ?? (explicitRebrand ? hashString(prompt) % 360 : (priorHue ?? (hashString(prompt) % 360)));

    return {
        mode,
        palette: buildPalette(baseHue, mode),
        source: (explicitHue !== null || explicitMode !== null) ? 'explicit' : 'semantic'
    };
}
