export type ReplaceRangeOp = {
    type: 'replace_range';
    path: string;
    start: number;
    end: number;
    lines: string[];
};

export type InsertAtOp = {
    type: 'insert_at';
    path: string;
    index: number;
    lines: string[];
};

export type DeleteRangeOp = {
    type: 'delete_range';
    path: string;
    start: number;
    end: number;
};

export type ReplaceFileOp = {
    type: 'replace_file';
    path: string;
    content: string;
};

export type PatchOp = ReplaceRangeOp | InsertAtOp | DeleteRangeOp | ReplaceFileOp;

export interface PatchApplyResult {
    ok: boolean;
    files: Map<string, string>;
    changedPaths: string[];
    error?: string;
}

function normalizePath(input: string): string | null {
    const normalized = input.trim().replace(/\\/g, '/');
    if (!normalized) return null;
    if (normalized.includes('..')) return null;
    const withLeadingSlash = normalized.startsWith('/') ? normalized : `/${normalized}`;
    if (withLeadingSlash.split('/').some(segment => segment === '.' || segment === '')) {
        return withLeadingSlash === '/' ? null : withLeadingSlash;
    }
    return withLeadingSlash;
}

function normalizeContent(content: string): string {
    return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function toLines(content: string): string[] {
    return normalizeContent(content).split('\n');
}

function fromLines(lines: string[]): string {
    return lines.join('\n');
}

function isValidRange(start: number, end: number, lineCount: number): boolean {
    return Number.isInteger(start)
        && Number.isInteger(end)
        && start >= 0
        && end >= start
        && end <= lineCount;
}

export function validatePatchOps(ops: unknown): { ok: boolean; ops: PatchOp[]; error?: string } {
    if (!Array.isArray(ops)) {
        return { ok: false, ops: [], error: 'Patch payload must contain an ops array.' };
    }
    if (ops.length === 0) {
        return { ok: false, ops: [], error: 'Patch ops array is empty.' };
    }

    const parsed: PatchOp[] = [];
    for (let i = 0; i < ops.length; i++) {
        const raw: any = ops[i];
        if (!raw || typeof raw !== 'object' || typeof raw.type !== 'string' || typeof raw.path !== 'string') {
            return { ok: false, ops: [], error: `op[${i}] is invalid.` };
        }
        const normalizedPath = normalizePath(raw.path);
        if (!normalizedPath) {
            return { ok: false, ops: [], error: `op[${i}] path is invalid.` };
        }

        if (raw.type === 'replace_range') {
            if (!Array.isArray(raw.lines) || !raw.lines.every((line: unknown) => typeof line === 'string')) {
                return { ok: false, ops: [], error: `op[${i}] replace_range lines must be string[].` };
            }
            parsed.push({
                type: 'replace_range',
                path: normalizedPath,
                start: raw.start,
                end: raw.end,
                lines: raw.lines
            });
            continue;
        }

        if (raw.type === 'insert_at') {
            if (!Array.isArray(raw.lines) || !raw.lines.every((line: unknown) => typeof line === 'string')) {
                return { ok: false, ops: [], error: `op[${i}] insert_at lines must be string[].` };
            }
            parsed.push({
                type: 'insert_at',
                path: normalizedPath,
                index: raw.index,
                lines: raw.lines
            });
            continue;
        }

        if (raw.type === 'delete_range') {
            parsed.push({
                type: 'delete_range',
                path: normalizedPath,
                start: raw.start,
                end: raw.end
            });
            continue;
        }

        if (raw.type === 'replace_file') {
            if (typeof raw.content !== 'string') {
                return { ok: false, ops: [], error: `op[${i}] replace_file content must be a string.` };
            }
            parsed.push({
                type: 'replace_file',
                path: normalizedPath,
                content: raw.content
            });
            continue;
        }

        return { ok: false, ops: [], error: `op[${i}] has unsupported type "${raw.type}".` };
    }

    return { ok: true, ops: parsed };
}

export function applyPatchOps(originalFiles: Map<string, string>, ops: PatchOp[]): PatchApplyResult {
    const files = new Map<string, string>();
    for (const [path, content] of originalFiles.entries()) {
        files.set(path, normalizeContent(content));
    }

    const changedPathSet = new Set<string>();

    for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        const current = files.get(op.path);
        if (typeof current !== 'string') {
            return { ok: false, files, changedPaths: [], error: `op[${i}] target file missing: ${op.path}` };
        }

        if (op.type === 'replace_file') {
            const nextContent = normalizeContent(op.content);
            files.set(op.path, nextContent);
            if (nextContent !== current) changedPathSet.add(op.path);
            continue;
        }

        const lines = toLines(current);
        if (op.type === 'replace_range') {
            if (!isValidRange(op.start, op.end, lines.length)) {
                return { ok: false, files, changedPaths: [], error: `op[${i}] replace_range out of bounds.` };
            }
            const nextLines = [...lines.slice(0, op.start), ...op.lines, ...lines.slice(op.end)];
            const nextContent = fromLines(nextLines);
            files.set(op.path, nextContent);
            if (nextContent !== current) changedPathSet.add(op.path);
            continue;
        }

        if (op.type === 'insert_at') {
            if (!Number.isInteger(op.index) || op.index < 0 || op.index > lines.length) {
                return { ok: false, files, changedPaths: [], error: `op[${i}] insert_at index out of bounds.` };
            }
            const nextLines = [...lines.slice(0, op.index), ...op.lines, ...lines.slice(op.index)];
            const nextContent = fromLines(nextLines);
            files.set(op.path, nextContent);
            if (nextContent !== current) changedPathSet.add(op.path);
            continue;
        }

        if (op.type === 'delete_range') {
            if (!isValidRange(op.start, op.end, lines.length)) {
                return { ok: false, files, changedPaths: [], error: `op[${i}] delete_range out of bounds.` };
            }
            const nextLines = [...lines.slice(0, op.start), ...lines.slice(op.end)];
            const nextContent = fromLines(nextLines);
            files.set(op.path, nextContent);
            if (nextContent !== current) changedPathSet.add(op.path);
            continue;
        }
    }

    const changedPaths = Array.from(changedPathSet.values());
    if (changedPaths.length === 0) {
        return { ok: false, files, changedPaths: [], error: 'Patch produced no changes.' };
    }

    return {
        ok: true,
        files,
        changedPaths
    };
}

