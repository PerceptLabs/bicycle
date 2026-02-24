import FS from '@isomorphic-git/lightning-fs';
import JSZip from 'jszip';
import { ensureProjectRegistry, getCurrentProjectId, getProjectRoot, PROJECTS_ROOT, touchProject } from './projects';
import { injectPreviewBridge } from './previewBridge';
import { APP_BRAND } from '../config/brand';

export const fs = new FS('workspace');
export const pfs = fs.promises;

function normalizeFilePath(path: string): string {
    if (!path) return '/';
    return path.startsWith('/') ? path : `/${path}`;
}

function trimSlashes(path: string): string {
    return path.replace(/^\/+|\/+$/g, '');
}

function joinPath(base: string, child: string): string {
    const a = trimSlashes(base);
    const b = trimSlashes(child);
    if (!a && !b) return '/';
    if (!a) return `/${b}`;
    if (!b) return `/${a}`;
    return `/${a}/${b}`;
}

function getExtensionLanguage(file: string): string {
    if (file.endsWith('.html')) return 'html';
    if (file.endsWith('.js')) return 'js';
    if (file.endsWith('.css')) return 'css';
    if (file.endsWith('.json')) return 'json';
    return '';
}

/**
 * Ensures a directory exists recursively.
 */
export async function ensureDir(dirPath: string) {
    const parts = dirPath.split('/').filter(Boolean);
    let currentPath = '';
    for (const part of parts) {
        currentPath += `/${part}`;
        try {
            await pfs.stat(currentPath);
        } catch (e: any) {
            if (e.code === 'ENOENT') {
                await pfs.mkdir(currentPath);
            } else {
                throw e;
            }
        }
    }
}

export async function readFile(path: string): Promise<string> {
    const content = await pfs.readFile(normalizeFilePath(path), 'utf8');
    return content as string;
}

export async function writeFile(path: string, content: string): Promise<void> {
    const normalized = normalizeFilePath(path);
    const lastSlashIndex = normalized.lastIndexOf('/');
    if (lastSlashIndex > 0) {
        const dir = normalized.substring(0, lastSlashIndex);
        await ensureDir(dir);
    }
    await pfs.writeFile(normalized, content, 'utf8');
}

export async function deleteFile(path: string): Promise<void> {
    await pfs.unlink(normalizeFilePath(path));
}

export async function listFiles(dir: string = '/'): Promise<string[]> {
    try {
        return await pfs.readdir(normalizeFilePath(dir));
    } catch {
        return [];
    }
}

export function toProjectPath(path: string, projectId: string = getCurrentProjectId()): string {
    const root = getProjectRoot(projectId);
    return joinPath(root, path);
}

export async function readProjectFile(path: string, projectId: string = getCurrentProjectId()): Promise<string> {
    return readFile(toProjectPath(path, projectId));
}

export async function getFileLines(
    path: string,
    centerLine: number,
    radius = 7,
    projectId: string = getCurrentProjectId()
): Promise<string> {
    const raw = await readProjectFile(path, projectId);
    const lines = raw.split(/\r?\n/);
    const safeCenter = Math.max(1, Math.min(centerLine, lines.length));
    const start = Math.max(1, safeCenter - radius);
    const end = Math.min(lines.length, safeCenter + radius);

    const excerpt: string[] = [];
    for (let lineNo = start; lineNo <= end; lineNo++) {
        const marker = lineNo === safeCenter ? '>' : ' ';
        excerpt.push(`${marker} ${String(lineNo).padStart(4, ' ')} | ${lines[lineNo - 1]}`);
    }

    return excerpt.join('\n');
}

export async function writeProjectFile(path: string, content: string, projectId: string = getCurrentProjectId()): Promise<void> {
    await writeFile(toProjectPath(path, projectId), content);
    touchProject(projectId);
}

export async function listProjectFiles(projectId: string = getCurrentProjectId()): Promise<string[]> {
    const dir = getProjectRoot(projectId);
    const entries = await listFiles(dir);
    const files: string[] = [];

    for (const entry of entries) {
        if (entry.startsWith('.')) continue;
        const fullPath = joinPath(dir, entry);
        try {
            const children = await pfs.readdir(fullPath);
            if (Array.isArray(children)) continue;
        } catch {
            // Not a directory.
        }
        files.push(entry);
    }

    return files;
}

export async function listProjectFilesDeep(projectId: string = getCurrentProjectId()): Promise<string[]> {
    const root = getProjectRoot(projectId);
    const files = await walkFiles(root);
    return files
        .map(file => file.relPath)
        .filter(file => !file.split('/').some(part => part.startsWith('.')))
        .sort((a, b) => a.localeCompare(b));
}

function buildDefaultHtml(projectName: string) {
    return `<!DOCTYPE html>
<html lang="en" data-theme="light">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${projectName}</title>
    <script src="https://cdn.tailwindcss.com"><\/script>
    <link href="https://cdn.jsdelivr.net/npm/daisyui@4.10.1/dist/full.min.css" rel="stylesheet" type="text/css" />
  </head>
  <body class="bg-base-200 min-h-screen">
    <div id="app"></div>
    <script type="module" src="./app.js"><\/script>
  </body>
</html>`;
}

function buildDefaultJs() {
    return `import { h, render } from 'https://esm.sh/preact@10.19.6';
import htm from 'https://esm.sh/htm@3.1.1';

const html = htm.bind(h);

function App() {
  return html\`
    <div class="min-h-screen bg-gradient-to-br from-base-200 via-base-100 to-base-200 flex items-center justify-center p-8">
      <div class="w-full max-w-3xl rounded-3xl border border-base-300 bg-base-100/85 backdrop-blur-sm shadow-2xl p-10 md:p-14">
        <div class="flex flex-col items-center text-center gap-8">
          <div class="relative w-full max-w-xl">
            <div class="absolute -inset-6 rounded-full bg-primary/10 blur-3xl"></div>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 150" width="100%" height="100%" class="relative mx-auto max-w-lg">
              <line x1="10" y1="127" x2="190" y2="127" stroke="#9ca3af" stroke-width="2" stroke-linecap="round" stroke-dasharray="8 24">
                <animate attributeName="stroke-dashoffset" from="0" to="32" dur="0.305s" repeatCount="indefinite" />
              </line>

              <path d="
                M 50 100 L 90 100 L 80 50 Z
                M 80 50 L 130 45 L 90 100 Z
                M 130 45 L 150 100
              " fill="none" stroke="#0d9488" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />

              <path d="
                M 70 50 L 90 50
                M 130 45 L 125 35 L 140 35
              " fill="none" stroke="#1f2937" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />

              <g>
                <circle cx="50" cy="100" r="25" fill="none" stroke="#1f2937" stroke-width="4" />
                <g stroke="#1f2937" stroke-width="2" stroke-linecap="round">
                  <line x1="25" y1="100" x2="75" y2="100" />
                  <line x1="50" y1="75" x2="50" y2="125" />
                  <line x1="32.32" y1="82.32" x2="67.68" y2="117.68" />
                  <line x1="32.32" y1="117.68" x2="67.68" y2="82.32" />
                </g>
                <animateTransform attributeName="transform" type="rotate" from="0 50 100" to="360 50 100" dur="1.5s" repeatCount="indefinite" />
              </g>

              <g>
                <circle cx="150" cy="100" r="25" fill="none" stroke="#1f2937" stroke-width="4" />
                <g stroke="#1f2937" stroke-width="2" stroke-linecap="round">
                  <line x1="125" y1="100" x2="175" y2="100" />
                  <line x1="150" y1="75" x2="150" y2="125" />
                  <line x1="132.32" y1="82.32" x2="167.68" y2="117.68" />
                  <line x1="132.32" y1="117.68" x2="167.68" y2="82.32" />
                </g>
                <animateTransform attributeName="transform" type="rotate" from="0 150 100" to="360 150 100" dur="1.5s" repeatCount="indefinite" />
              </g>

              <g>
                <circle cx="90" cy="100" r="5" fill="#1f2937" />
                <line x1="90" y1="100" x2="90" y2="86" stroke="#1f2937" stroke-width="3" stroke-linecap="round" />
                <circle cx="90" cy="86" r="3" fill="#1f2937" />

                <line x1="90" y1="100" x2="90" y2="114" stroke="#1f2937" stroke-width="3" stroke-linecap="round" />
                <circle cx="90" cy="114" r="3" fill="#1f2937" />
                <animateTransform attributeName="transform" type="rotate" from="0 90 100" to="360 90 100" dur="1.5s" repeatCount="indefinite" />
              </g>
            </svg>
          </div>
          <div class="space-y-3">
            <h1 class="text-4xl md:text-5xl font-extrabold tracking-tight text-primary">${APP_BRAND}</h1>
            <p class="text-base-content/70 max-w-xl">
              Your workspace is ready. Start prompting to build your first experience.
            </p>
          </div>
        </div>
      </div>
    </div>
  \`;
}

render(html\`<\${App} />\`, document.getElementById('app'));
`;
}

async function fileExists(path: string) {
    try {
        await pfs.stat(normalizeFilePath(path));
        return true;
    } catch {
        return false;
    }
}

async function migrateLegacyRootToProject(projectId: string) {
    const legacyHtml = '/index.html';
    const legacyJs = '/app.js';
    const projectHtml = toProjectPath('/index.html', projectId);
    const projectJs = toProjectPath('/app.js', projectId);

    const hasLegacyHtml = await fileExists(legacyHtml);
    const hasLegacyJs = await fileExists(legacyJs);
    if (!hasLegacyHtml && !hasLegacyJs) return;

    const hasProjectHtml = await fileExists(projectHtml);
    const hasProjectJs = await fileExists(projectJs);

    if (hasLegacyHtml && !hasProjectHtml) {
        const html = await readFile(legacyHtml);
        await writeFile(projectHtml, html);
    }
    if (hasLegacyJs && !hasProjectJs) {
        const js = await readFile(legacyJs);
        await writeFile(projectJs, js);
    }
}

export async function initProjectWorkspace(projectId: string = getCurrentProjectId()) {
    const root = getProjectRoot(projectId);
    await ensureDir(root);

    await migrateLegacyRootToProject(projectId);

    const htmlPath = toProjectPath('/index.html', projectId);
    const jsPath = toProjectPath('/app.js', projectId);

    if (!(await fileExists(htmlPath))) {
        await writeFile(htmlPath, injectPreviewBridge(buildDefaultHtml(projectId)));
    }

    if (!(await fileExists(jsPath))) {
        await writeFile(jsPath, buildDefaultJs());
    }
}

export async function initWorkspace() {
    ensureProjectRegistry();
    await ensureDir(PROJECTS_ROOT);
    await initProjectWorkspace();
}

async function walkFiles(dir: string, relativePrefix = ''): Promise<Array<{ fullPath: string; relPath: string }>> {
    const entries = await listFiles(dir);
    const collected: Array<{ fullPath: string; relPath: string }> = [];

    for (const entry of entries) {
        if (entry.startsWith('.')) continue;
        const fullPath = joinPath(dir, entry);
        const relPath = relativePrefix ? `${relativePrefix}/${entry}` : entry;

        try {
            const children = await pfs.readdir(fullPath);
            if (Array.isArray(children)) {
                const nested = await walkFiles(fullPath, relPath);
                collected.push(...nested);
                continue;
            }
        } catch {
            // Not a directory.
        }

        collected.push({ fullPath, relPath });
    }

    return collected;
}

export async function exportProjectAsZip(projectId: string = getCurrentProjectId()) {
    await initProjectWorkspace(projectId);

    const zip = new JSZip();
    const root = getProjectRoot(projectId);
    const files = await walkFiles(root);

    for (const file of files) {
        const bytes = await pfs.readFile(file.fullPath);
        zip.file(file.relPath, bytes as any);
    }

    if (files.length === 0) {
        zip.file('README.txt', 'Project is empty.');
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${projectId}.zip`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
}

export async function getProjectContext(projectId: string = getCurrentProjectId(), maxCharsPerFile = 20000): Promise<string> {
    await initProjectWorkspace(projectId);
    const files = await listProjectFilesDeep(projectId);
    if (files.length === 0) return 'No files found in the project workspace.';

    const ordered = [...files].sort((a, b) => {
        const pri = (file: string) => (file === 'index.html' ? 0 : file === 'app.js' ? 1 : 2);
        const pa = pri(a);
        const pb = pri(b);
        if (pa !== pb) return pa - pb;
        return a.localeCompare(b);
    });

    const chunks: string[] = [];
    for (const file of ordered) {
        const raw = await readProjectFile(`/${file}`, projectId);
        const truncated = raw.length > maxCharsPerFile
            ? `${raw.slice(0, maxCharsPerFile)}\n/* truncated */`
            : raw;
        const lang = getExtensionLanguage(file);
        chunks.push(`File: ${file}\n\`\`\`${lang}\n${truncated}\n\`\`\``);
    }

    return chunks.join('\n\n');
}

export async function resetWorkspace() {
    try {
        await new Promise<void>((resolve, reject) => {
            const req = indexedDB.deleteDatabase('workspace');
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
            req.onblocked = () => resolve();
        });
    } catch (e) {
        console.error('IndexedDB delete failed', e);
    }

    await initWorkspace();
}
