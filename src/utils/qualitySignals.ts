import { parse } from 'acorn';

export interface JsValidationResult {
    ok: boolean;
    message?: string;
    line?: number;
    column?: number;
}

export function validateJsSyntax(code: string): JsValidationResult {
    try {
        parse(code, {
            ecmaVersion: 'latest',
            sourceType: 'module',
            allowHashBang: true
        });
        return { ok: true };
    } catch (error: any) {
        const line = typeof error?.loc?.line === 'number' ? error.loc.line : undefined;
        const column = typeof error?.loc?.column === 'number' ? error.loc.column + 1 : undefined;
        return {
            ok: false,
            message: error?.message || 'Invalid JavaScript syntax.',
            line,
            column
        };
    }
}

export type ReadabilityRiskCode = 'R001' | 'R002' | 'R003' | 'R004' | 'R005';

export interface ReadabilityRisk {
    code: ReadabilityRiskCode;
    level: 'warn';
    message: string;
    evidence?: string;
    weight: number;
}

function includesAny(input: string, patterns: RegExp[]): RegExp | null {
    for (const pattern of patterns) {
        if (pattern.test(input)) return pattern;
    }
    return null;
}

function collectMatchedText(source: string, regex: RegExp): string | undefined {
    const match = source.match(regex);
    return match ? match[0].slice(0, 220) : undefined;
}

function hasCommerceSignals(source: string): boolean {
    return /\b(cart|checkout|product|catalog|store|shop|add to cart|drawer|modal)\b/i.test(source);
}

export function analyzeReadabilityRisks(html: string, js: string): ReadabilityRisk[] {
    const risks: ReadabilityRisk[] = [];
    const combined = `${html}\n${js}`;

    const transparentPattern = includesAny(combined, [
        /\bbg-transparent\b/i,
        /\bopacity-0\b/i,
        /\bopacity-\[(0?\.\d+)\]/i,
        /rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0(?:\.0+)?\s*\)/i
    ]);
    if (transparentPattern && hasCommerceSignals(combined)) {
        risks.push({
            code: 'R001',
            level: 'warn',
            message: 'Transparent critical surface detected in commerce-related UI.',
            evidence: collectMatchedText(combined, transparentPattern),
            weight: 25
        });
    }

    const overlaySignal = /\b(drawer|modal|overlay|fly-in|panel)\b/i.test(combined);
    const readableSurfaceSignal = /\bbg-base-[123]\b|\bbg-(white|neutral-\d{2,3}|slate-\d{2,3}|zinc-\d{2,3}|gray-\d{2,3})\b/i.test(combined);
    if (overlaySignal && !readableSurfaceSignal) {
        risks.push({
            code: 'R002',
            level: 'warn',
            message: 'Overlay/panel found without explicit readable surface background.',
            evidence: 'drawer/modal/panel keywords detected without clear surface class',
            weight: 20
        });
    }

    const whiteSurfaceMatches = combined.match(/\bbg-white\b/gi)?.length || 0;
    const layerSignals = combined.match(/\b(shadow|ring-|border-|bg-base-[123]|backdrop-blur)\b/gi)?.length || 0;
    if (whiteSurfaceMatches >= 3 && layerSignals < 3) {
        risks.push({
            code: 'R003',
            level: 'warn',
            message: 'Layout may be visually flat or washed out.',
            evidence: `bg-white matches=${whiteSurfaceMatches}, layer signals=${layerSignals}`,
            weight: 15
        });
    }

    const hasPrimaryAction = /\b(btn-primary|primary cta|add to cart|buy now)\b/i.test(combined);
    const weakPrimaryStyle = includesAny(combined, [
        /\bbtn-ghost\b/i,
        /\bopacity-(20|30|40)\b/i,
        /\btext-[a-z]+-100\b/i
    ]);
    if (hasPrimaryAction && weakPrimaryStyle) {
        risks.push({
            code: 'R004',
            level: 'warn',
            message: 'Primary action may have weak emphasis/contrast.',
            evidence: collectMatchedText(combined, weakPrimaryStyle),
            weight: 10
        });
    }

    const lowOpacityText = includesAny(combined, [
        /\btext-[a-z]+(?:-\d{2,3})?\/(10|20|30|40)\b/i,
        /\bopacity-(10|20|30|40)\b/i
    ]);
    if (lowOpacityText) {
        risks.push({
            code: 'R005',
            level: 'warn',
            message: 'Low-opacity text may reduce readability for key content or controls.',
            evidence: collectMatchedText(combined, lowOpacityText),
            weight: 12
        });
    }

    return risks;
}

export interface ThemeContractResult {
    ok: boolean;
    themeName?: string;
    missing: string[];
    reason?: string;
}

const GENERIC_THEMES = new Set(['light', 'dark']);
const REQUIRED_THEME_TOKENS = ['--p', '--pf', '--s', '--sf', '--a', '--af', '--b1', '--b2', '--bc'] as const;

function parseHtmlThemeName(html: string): string | undefined {
    const htmlMatch = html.match(/<html\b([^>]*)>/i);
    if (!htmlMatch) return undefined;

    const attrs = htmlMatch[1] || '';
    const quoted = attrs.match(/\bdata-theme\s*=\s*["']([^"']+)["']/i);
    if (quoted) return quoted[1].trim();

    const bare = attrs.match(/\bdata-theme\s*=\s*([^\s>]+)/i);
    if (bare) return bare[1].trim().replace(/^['"]|['"]$/g, '');

    return undefined;
}

export function validateThemeContract(html: string): ThemeContractResult {
    const themeNameRaw = parseHtmlThemeName(html);
    if (!themeNameRaw) {
        return {
            ok: false,
            missing: [...REQUIRED_THEME_TOKENS],
            reason: 'Missing data-theme on the HTML root.'
        };
    }

    const themeName = themeNameRaw.trim();
    if (!themeName) {
        return {
            ok: false,
            themeName,
            missing: [...REQUIRED_THEME_TOKENS],
            reason: 'Theme name is empty.'
        };
    }

    if (GENERIC_THEMES.has(themeName.toLowerCase())) {
        return {
            ok: false,
            themeName,
            missing: [...REQUIRED_THEME_TOKENS],
            reason: 'Theme name should be project-specific, not "light" or "dark".'
        };
    }

    const missing = REQUIRED_THEME_TOKENS.filter(token => {
        const tokenRegex = new RegExp(`${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`, 'i');
        return !tokenRegex.test(html);
    });

    return {
        ok: missing.length === 0,
        themeName,
        missing,
        reason: missing.length > 0 ? 'Missing required Daisy theme tokens.' : undefined
    };
}
