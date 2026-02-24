// Sync contract:
// - Runtime source of truth for generation guidance lives in this file.
// - Keep docs/design-guidelines.md in sync whenever this file changes.

export type DesignArchetype = 'energy' | 'wellness-tea' | 'saas-productivity' | 'editorial-modern';

function includesAny(text: string, needles: string[]): boolean {
    return needles.some(needle => text.includes(needle));
}

function isRefinementPrompt(prompt: string): boolean {
    const lower = prompt.toLowerCase();
    return includesAny(lower, [
        'make it fresher',
        'more impactful',
        'refine',
        'improve this',
        'iterate on this',
        'keep the same',
        'version 2'
    ]);
}

export function inferDesignArchetype(prompt: string): DesignArchetype {
    const lower = prompt.toLowerCase();

    if (includesAny(lower, [
        'energy drink',
        'pre-workout',
        'gaming',
        'esports',
        'nightlife',
        'club',
        'neon',
        'high impact'
    ])) {
        return 'energy';
    }

    if (includesAny(lower, [
        'tea',
        'wellness',
        'cozy',
        'calm',
        'sleep',
        'health',
        'soothing',
        'organic',
        'comfort'
    ])) {
        return 'wellness-tea';
    }

    if (includesAny(lower, [
        'saas',
        'dashboard',
        'analytics',
        'b2b',
        'productivity',
        'workflow',
        'crm',
        'admin'
    ])) {
        return 'saas-productivity';
    }

    return 'editorial-modern';
}

export function isCommerceIntent(prompt: string): boolean {
    const lower = prompt.toLowerCase();
    return includesAny(lower, [
        'shop',
        'store',
        'cart',
        'checkout',
        'product',
        'catalog',
        'ecommerce',
        'e-commerce',
        'sku',
        'buy now'
    ]);
}

export function isBlueBrandIntent(prompt: string): boolean {
    const lower = prompt.toLowerCase();
    return includesAny(lower, [
        'blue brand',
        'blue palette',
        'blue theme',
        'cobalt',
        'azure',
        'navy',
        'indigo'
    ]);
}

function buildBaseQualityGuidance(prompt: string): string {
    const blueIntent = isBlueBrandIntent(prompt);
    const blueRule = blueIntent
        ? 'Blue is explicitly requested; keep it intentional and token-driven.'
        : 'Avoid accidental default Daisy blue for CTA/default/hover/active states.';

    return `Base quality guidance:
1. Build a complete product experience, not a tutorial skeleton.
2. Use clear section hierarchy and confident typography rhythm.
3. Keep spacing intentional (8px cadence) with layered surfaces.
4. Color and component states should come from project theme tokens.
5. ${blueRule}
6. Keep body text and CTA labels readable against their backgrounds in default, hover, and active states.
7. Avoid low-opacity text for primary content, buttons, and key actions.
8. Avoid transparent text containers on busy backgrounds unless an opaque/elevated backing preserves readability.
9. Make primary CTA visually distinct with clear hover/active/focus-visible states.`;
}

function buildArchetypeGuidance(archetype: DesignArchetype): string {
    switch (archetype) {
        case 'energy':
            return `Archetype cues (energy):
1. Bold tone, higher contrast, sharp hierarchy.
2. Keep sections focused and kinetic without clutter.
3. Prefer punchy headline-to-CTA flow and decisive actions.`;
        case 'wellness-tea':
            return `Archetype cues (wellness/tea):
1. Calm, warm, breathable composition with generous whitespace.
2. Softer contrast jumps, but preserve readability and emphasis.
3. Gentle transitions and clear product storytelling.`;
        case 'saas-productivity':
            return `Archetype cues (saas/productivity):
1. Structured information grouping and crisp component alignment.
2. Clear utility hierarchy and reliable state affordances.
3. Keep interface precise and professional with readable density.`;
        case 'editorial-modern':
            return `Archetype cues (editorial-modern):
1. Content-forward layout with intentional typographic contrast.
2. Modular sections and measured accent usage.
3. Keep aesthetic direction strong and coherent, not generic.`;
    }
}

function buildCommerceGuidance(prompt: string): string {
    if (!isCommerceIntent(prompt)) {
        return 'Commerce cues: apply only when request includes shop/store/cart intent.';
    }

    return `Commerce cues:
1. Keep product hierarchy scannable (title, value, price, primary action).
2. Keep cart affordance stable and easy to find.
3. Any drawer/modal/fly-in cart must use explicit readable surfaces and clear separation.
4. Do not make critical cart or checkout panels fully transparent.`;
}

function buildRefinementGuidance(prompt: string): string {
    const refinement = isRefinementPrompt(prompt);
    const refinementLine = refinement
        ? 'This prompt is a refinement: evolve quality while preserving concept and domain continuity.'
        : 'If this becomes a refinement later, preserve concept and evolve quality rather than pivoting.';

    return `Refinement continuity:
1. ${refinementLine}
2. Preserve palette unless user explicitly requests recolor/rebrand.
3. Do not switch to unrelated app concepts.
4. Do not regress to flat, empty, or washed-out output.`;
}

export function buildDesignGuidanceBlock(prompt: string): string {
    const archetype = inferDesignArchetype(prompt);
    return [
        buildBaseQualityGuidance(prompt),
        buildArchetypeGuidance(archetype),
        buildCommerceGuidance(prompt),
        buildRefinementGuidance(prompt),
        'Internal self-check before final answer: verify hierarchy, readability, state clarity, and theme-token coherence.'
    ].join('\n\n');
}
