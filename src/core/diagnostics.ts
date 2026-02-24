import { getFileLines } from './fs';
import { getCurrentProjectId } from './projects';

export type DiagnosticLevel = 'error' | 'warn' | 'info';
export type DiagnosticSource = 'preview' | 'builder';
export type DiagnosticErrorKind = 'syntax' | 'runtime' | 'network' | 'other';

export interface DiagnosticEntry {
    id: string;
    projectId: string;
    level: DiagnosticLevel;
    source: DiagnosticSource;
    message: string;
    details?: string;
    filePath?: string;
    line?: number;
    column?: number;
    errorKind?: DiagnosticErrorKind;
    createdAt: string;
}

const DIAGNOSTICS_KEY = 'nanobuild-diagnostics';
const DIAGNOSTICS_CHANGED_EVENT = 'diagnostics:changed';
const MAX_TOTAL = 300;

function readAll(): DiagnosticEntry[] {
    const raw = localStorage.getItem(DIAGNOSTICS_KEY);
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed as DiagnosticEntry[];
    } catch {
        // ignore parse failure
    }
    return [];
}

function writeAll(entries: DiagnosticEntry[]) {
    localStorage.setItem(DIAGNOSTICS_KEY, JSON.stringify(entries.slice(-MAX_TOTAL)));
}

function stringifyValue(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack || ''}`.trim();
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function isNoise(message: string): boolean {
    const lower = message.toLowerCase();
    return lower.includes('failed to get subsystem status for purpose')
        || lower.includes('could not establish connection. receiving end does not exist')
        || lower.includes('cdn.tailwindcss.com should not be used in production');
}

function inferErrorKind(message: string, details: string): DiagnosticErrorKind {
    const text = `${message}\n${details}`.toLowerCase();
    if (/syntaxerror|unexpected token|invalid or unexpected token|parse error/.test(text)) return 'syntax';
    if (/failed to fetch|network|cors|timed out|timeout/.test(text)) return 'network';
    if (/runtime|unhandled|referenceerror|typeerror|rangeerror/.test(text)) return 'runtime';
    return 'other';
}

function formatLocation(entry: Pick<DiagnosticEntry, 'filePath' | 'line' | 'column'>): string {
    if (!entry.filePath) return '';
    const lc = typeof entry.line === 'number'
        ? `:${entry.line}${typeof entry.column === 'number' ? `:${entry.column}` : ''}`
        : '';
    return `${entry.filePath}${lc}`;
}

export function addDiagnostic(input: {
    projectId?: string;
    level: DiagnosticLevel;
    source: DiagnosticSource;
    message: unknown;
    details?: unknown;
    filePath?: string;
    line?: number;
    column?: number;
    errorKind?: DiagnosticErrorKind;
}) {
    const projectId = input.projectId || getCurrentProjectId();
    const message = stringifyValue(input.message);
    if (!message || isNoise(message)) return;

    const details = input.details ? stringifyValue(input.details) : undefined;
    const normalizedDetails = details ? details.slice(0, 2000) : undefined;
    const entries = readAll();
    const item: DiagnosticEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        projectId,
        level: input.level,
        source: input.source,
        message: message.slice(0, 800),
        details: normalizedDetails,
        filePath: input.filePath,
        line: typeof input.line === 'number' ? input.line : undefined,
        column: typeof input.column === 'number' ? input.column : undefined,
        errorKind: input.errorKind || inferErrorKind(message, normalizedDetails || ''),
        createdAt: new Date().toISOString()
    };
    entries.push(item);
    writeAll(entries);
    window.dispatchEvent(new Event(DIAGNOSTICS_CHANGED_EVENT));
}

export function getProjectDiagnostics(projectId: string = getCurrentProjectId(), limit = 30): DiagnosticEntry[] {
    const entries = readAll().filter(entry => entry.projectId === projectId);
    return entries.slice(-limit);
}

export function getLatestSyntaxFailure(projectId: string = getCurrentProjectId()): DiagnosticEntry | null {
    const entries = getProjectDiagnostics(projectId, 120).filter(entry => entry.errorKind === 'syntax');
    return entries.length > 0 ? entries[entries.length - 1] : null;
}

export async function getLatestSyntaxFailureContext(projectId: string = getCurrentProjectId(), radius = 7): Promise<string> {
    const failure = getLatestSyntaxFailure(projectId);
    if (!failure) return 'No recent syntax failures.';

    const location = formatLocation(failure) || 'unknown location';
    const lines: string[] = [
        `Latest syntax failure: ${failure.message}`,
        `Location: ${location}`
    ];

    if (failure.details) {
        lines.push(`Details: ${failure.details}`);
    }

    if (failure.filePath && typeof failure.line === 'number') {
        try {
            const snippet = await getFileLines(failure.filePath, failure.line, radius, projectId);
            lines.push('Code excerpt:');
            lines.push(snippet);
        } catch (error) {
            lines.push(`Code excerpt unavailable: ${stringifyValue(error)}`);
        }
    }

    return lines.join('\n');
}

export function clearProjectDiagnostics(projectId: string = getCurrentProjectId()) {
    const entries = readAll().filter(entry => entry.projectId !== projectId);
    writeAll(entries);
    window.dispatchEvent(new Event(DIAGNOSTICS_CHANGED_EVENT));
}

export function getDiagnosticsChangedEventName() {
    return DIAGNOSTICS_CHANGED_EVENT;
}

export function getDiagnosticsSummaryForPrompt(projectId: string = getCurrentProjectId(), limit = 8): string {
    const entries = getProjectDiagnostics(projectId, 80)
        .filter(entry => entry.level === 'error' || entry.level === 'warn')
        .slice(-limit);

    if (entries.length === 0) return 'No recent runtime diagnostics.';

    return entries
        .map(entry => {
            const kind = entry.errorKind ? `${entry.errorKind.toUpperCase()} ` : '';
            const location = formatLocation(entry);
            const head = `[${entry.level.toUpperCase()}] ${kind}${entry.message}${location ? ` @ ${location}` : ''}`;
            if (!entry.details) return head;
            return `${head}\nDetails: ${entry.details}`;
        })
        .join('\n\n');
}

export function buildShareableDiagnostics(projectId: string = getCurrentProjectId()) {
    const entries = getProjectDiagnostics(projectId, 50);
    if (entries.length === 0) return `Project: ${projectId}\nNo diagnostics captured.`;

    const lines = [`Project: ${projectId}`, `Captured diagnostics: ${entries.length}`, ''];
    for (const entry of entries) {
        const location = formatLocation(entry);
        const kind = entry.errorKind ? `/${entry.errorKind}` : '';
        lines.push(`${entry.createdAt} [${entry.source}/${entry.level}${kind}] ${entry.message}${location ? ` @ ${location}` : ''}`);
        if (entry.details) lines.push(entry.details);
        lines.push('');
    }
    return lines.join('\n').trim();
}

