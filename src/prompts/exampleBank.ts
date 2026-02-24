export type PromptShotKind = 'layout' | 'interaction' | 'theme' | 'commerce' | 'reliability';
export type PromptShotArchetype = 'energy' | 'wellness-tea' | 'saas-productivity' | 'editorial-modern';

export interface PromptExample {
    id: string;
    kind: PromptShotKind;
    archetype: PromptShotArchetype;
    domain: string;
    tags: string[];
    quality: 1 | 2 | 3 | 4 | 5;
    htmlSnippet: string;
    jsSnippet: string;
    notes: string;
    patternGroup: string;
}

export const designExamples: PromptExample[] = [
    {
        id: 'd-energy-hero-split',
        kind: 'layout',
        archetype: 'energy',
        domain: 'brand-landing',
        tags: ['hero', 'contrast', 'grid', 'cta'],
        quality: 4,
        htmlSnippet: '<section class="grid lg:grid-cols-2 gap-10 items-center"><div><h1 class="text-6xl font-black">...</h1><button class="btn btn-primary">Shop</button></div><aside class="card bg-base-200 shadow-xl">...</aside></section>',
        jsSnippet: 'const [activeTag, setActiveTag] = useState("all"); const filtered = items.filter(x => activeTag === "all" || x.tag === activeTag);',
        notes: 'Lead with one decisive CTA and a supporting product surface.',
        patternGroup: 'hero-split'
    },
    {
        id: 'd-wellness-soft-bands',
        kind: 'theme',
        archetype: 'wellness-tea',
        domain: 'beverage',
        tags: ['soft', 'warm', 'calm', 'cards'],
        quality: 5,
        htmlSnippet: '<main class="bg-base-100"><section class="bg-base-200 rounded-3xl p-8">...</section><section class="grid md:grid-cols-3 gap-6 mt-8">...</section></main>',
        jsSnippet: 'const sections = ["Sleep", "Focus", "Joy"]; const [section, setSection] = useState(sections[0]);',
        notes: 'Use layered surfaces and generous spacing; avoid flat-white pages.',
        patternGroup: 'soft-band'
    },
    {
        id: 'd-saas-metrics-rail',
        kind: 'layout',
        archetype: 'saas-productivity',
        domain: 'dashboard',
        tags: ['metrics', 'table', 'filters'],
        quality: 4,
        htmlSnippet: '<section class="grid xl:grid-cols-[1fr_320px] gap-6"><div class="space-y-6">...</div><aside class="card bg-base-200 sticky top-4">...</aside></section>',
        jsSnippet: 'const [query, setQuery] = useState(""); const visible = rows.filter(r => r.name.toLowerCase().includes(query.toLowerCase()));',
        notes: 'Prefer clear grouping and stable information hierarchy.',
        patternGroup: 'metrics-rail'
    },
    {
        id: 'd-editorial-feature-grid',
        kind: 'layout',
        archetype: 'editorial-modern',
        domain: 'showcase',
        tags: ['feature', 'stories', 'magazine'],
        quality: 4,
        htmlSnippet: '<section class="grid md:grid-cols-12 gap-6"><article class="md:col-span-8 card bg-base-100 shadow-md">...</article><aside class="md:col-span-4 space-y-4">...</aside></section>',
        jsSnippet: 'const [storyId, setStoryId] = useState(stories[0].id); const story = stories.find(s => s.id === storyId) || stories[0];',
        notes: 'Create contrast with layout proportions, not only color.',
        patternGroup: 'feature-grid'
    },
    {
        id: 'd-commerce-product-matrix',
        kind: 'commerce',
        archetype: 'wellness-tea',
        domain: 'storefront',
        tags: ['product-grid', 'price', 'cta', 'cart'],
        quality: 5,
        htmlSnippet: '<section class="grid sm:grid-cols-2 xl:grid-cols-3 gap-6">{products.map(p => <article class="card bg-base-100 border border-base-300">...</article>)}</section>',
        jsSnippet: 'const [cart, setCart] = useState([]); const addToCart = (p) => setCart(prev => [...prev, p]);',
        notes: 'Keep price, quantity, and add action scannable and grouped.',
        patternGroup: 'commerce-matrix'
    },
    {
        id: 'd-commerce-cart-panel-readable',
        kind: 'commerce',
        archetype: 'editorial-modern',
        domain: 'storefront',
        tags: ['drawer', 'cart', 'surface', 'contrast'],
        quality: 5,
        htmlSnippet: '<aside class="fixed right-0 top-0 h-full w-[380px] bg-base-100 border-l border-base-300 shadow-2xl">...</aside>',
        jsSnippet: 'const [cartOpen, setCartOpen] = useState(false); const cartTotal = cart.reduce((sum, item) => sum + item.price, 0);',
        notes: 'Critical panels must have explicit surface color and elevation.',
        patternGroup: 'cart-panel'
    },
    {
        id: 'd-energy-accent-strip',
        kind: 'theme',
        archetype: 'energy',
        domain: 'brand-landing',
        tags: ['accent-band', 'high-contrast', 'motion'],
        quality: 4,
        htmlSnippet: '<section class="rounded-2xl bg-primary text-primary-content p-4 flex items-center justify-between">...</section>',
        jsSnippet: 'const [ticker, setTicker] = useState(0); useEffect(() => { const id = setInterval(() => setTicker(t => (t + 1) % headlines.length), 2600); return () => clearInterval(id); }, []);',
        notes: 'Use one bold accent region to avoid washed-out layouts.',
        patternGroup: 'accent-strip'
    },
    {
        id: 'd-saas-filter-toolbar',
        kind: 'interaction',
        archetype: 'saas-productivity',
        domain: 'app-ui',
        tags: ['toolbar', 'filters', 'tabs'],
        quality: 4,
        htmlSnippet: '<div class="flex flex-wrap gap-2"><input class="input input-bordered" /><div role="tablist" class="tabs tabs-boxed">...</div></div>',
        jsSnippet: 'const [tab, setTab] = useState("all"); const [sort, setSort] = useState("recent");',
        notes: 'State should improve usability, not appear as filler interaction.',
        patternGroup: 'filter-toolbar'
    }
];

export const reliabilityExamples: PromptExample[] = [
    {
        id: 'r-preact-htm-preamble',
        kind: 'reliability',
        archetype: 'editorial-modern',
        domain: 'runtime',
        tags: ['imports', 'render', 'htm', 'preact'],
        quality: 5,
        htmlSnippet: '<div id="app"></div><script type="module" src="./app.js"></script>',
        jsSnippet: "import { h, render } from 'https://esm.sh/preact@10.19.6';\nimport { useState } from 'https://esm.sh/preact@10.19.6/hooks';\nimport htm from 'https://esm.sh/htm@3.1.1';\nconst html = htm.bind(h);",
        notes: 'Always define h/render/htm/html before JSX-template usage.',
        patternGroup: 'runtime-preamble'
    },
    {
        id: 'r-single-module-entry',
        kind: 'reliability',
        archetype: 'editorial-modern',
        domain: 'runtime',
        tags: ['single-file', 'esm', 'imports'],
        quality: 5,
        htmlSnippet: '<script type="module" src="./app.js"></script>',
        jsSnippet: '/* Keep logic in this file only. Avoid local imports like ./main.js or ./components.js in this runtime mode. */',
        notes: 'Single-module entry avoids local file resolution failures.',
        patternGroup: 'single-module'
    },
    {
        id: 'r-safe-root-render',
        kind: 'reliability',
        archetype: 'editorial-modern',
        domain: 'runtime',
        tags: ['root', 'render', 'fallback'],
        quality: 4,
        htmlSnippet: '<div id="app"></div>',
        jsSnippet: "const root = document.getElementById('app');\nif (!root) throw new Error('Missing #app root');\nrender(html`<${App} />`, root);",
        notes: 'Defensive root lookup improves diagnosability for blank previews.',
        patternGroup: 'safe-root'
    },
    {
        id: 'r-state-update-immutability',
        kind: 'reliability',
        archetype: 'saas-productivity',
        domain: 'state',
        tags: ['state', 'immutability', 'events'],
        quality: 4,
        htmlSnippet: '<button class="btn btn-primary">Add</button>',
        jsSnippet: 'setItems(prev => [...prev, nextItem]);\nsetForm(prev => ({ ...prev, name: "" }));',
        notes: 'Use immutable updates for predictable rerenders.',
        patternGroup: 'state-immutability'
    },
    {
        id: 'r-deterministic-keys',
        kind: 'reliability',
        archetype: 'saas-productivity',
        domain: 'list-rendering',
        tags: ['keys', 'list', 'render'],
        quality: 3,
        htmlSnippet: '<ul>{items.map(item => <li key={item.id}>...</li>)}</ul>',
        jsSnippet: 'const normalized = data.map((x, i) => ({ ...x, id: x.id || `item-${i}` }));',
        notes: 'Stable keys prevent rendering glitches in dynamic lists.',
        patternGroup: 'list-keys'
    },
    {
        id: 'r-event-handler-safety',
        kind: 'reliability',
        archetype: 'editorial-modern',
        domain: 'events',
        tags: ['event', 'null-safe', 'forms'],
        quality: 3,
        htmlSnippet: '<input class="input input-bordered" />',
        jsSnippet: 'const onInput = (e) => setValue(String(e?.currentTarget?.value || ""));',
        notes: 'Guard event access in generated code to reduce runtime exceptions.',
        patternGroup: 'event-safe'
    },
    {
        id: 'r-cart-total-safety',
        kind: 'reliability',
        archetype: 'wellness-tea',
        domain: 'commerce',
        tags: ['cart', 'totals', 'number'],
        quality: 4,
        htmlSnippet: '<p class="font-semibold">Total: ...</p>',
        jsSnippet: 'const total = cart.reduce((sum, item) => sum + Number(item?.price || 0), 0);',
        notes: 'Coerce numeric values to avoid NaN in totals.',
        patternGroup: 'cart-total'
    }
];

