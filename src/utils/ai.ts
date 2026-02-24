import { getSettings } from '../core/settings';
import { INFERENCE_CLIENT_TITLE } from '../config/brand';
import type { PatchOp } from './patchOps';

export interface GenerationResult {
    html: string;
    js: string;
    files?: GeneratedFile[];
}

export interface GeneratedFile {
    path: string;
    content: string;
}

export interface PatchGenerationResult {
    ops: PatchOp[];
}

export interface GenerationCallbacks {
    onPhase?: (message: string) => void;
    onToken?: (delta: string) => void;
    onComplete?: (finalText: string) => void;
}

function normalizeBaseUrl(input: string): string {
    return input.trim().replace(/\/+$/, '');
}

function isLocalHostUrl(input: string): boolean {
    try {
        const url = new URL(input);
        return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '0.0.0.0';
    } catch {
        return false;
    }
}

function pickPreferredModel(models: string[]): string {
    const isCloudModel = (id: string) => /(:cloud|-cloud)(:|$)/i.test(id);
    const isEmbeddingModel = (id: string) => /embed/i.test(id);

    const preferred = models.find(id => !isCloudModel(id) && !isEmbeddingModel(id));
    if (preferred) return preferred;

    const nonCloud = models.find(id => !isCloudModel(id));
    if (nonCloud) return nonCloud;

    return models[0];
}

function extractTextContent(content: unknown): string {
    if (typeof content === 'string') return content;

    if (Array.isArray(content)) {
        return content
            .map((part: any) => {
                if (typeof part === 'string') return part;
                if (part && typeof part.text === 'string') return part.text;
                return '';
            })
            .join('\n')
            .trim();
    }

    return '';
}

function extractFirstJSONObject(input: string): string | null {
    let start = -1;
    let depth = 0;
    let inString = false;
    let isEscaped = false;

    for (let i = 0; i < input.length; i++) {
        const ch = input[i];

        if (inString) {
            if (isEscaped) {
                isEscaped = false;
                continue;
            }
            if (ch === '\\') {
                isEscaped = true;
                continue;
            }
            if (ch === '"') {
                inString = false;
            }
            continue;
        }

        if (ch === '"') {
            inString = true;
            continue;
        }

        if (ch === '{') {
            if (depth === 0) start = i;
            depth++;
            continue;
        }

        if (ch === '}') {
            if (depth > 0) depth--;
            if (depth === 0 && start >= 0) {
                return input.slice(start, i + 1);
            }
        }
    }

    return null;
}

function parseGenerationResult(rawContent: string): GenerationResult {
    const trimmed = rawContent.trim();

    const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    const unfenced = fencedMatch ? fencedMatch[1].trim() : trimmed;
    const extracted = extractFirstJSONObject(unfenced);

    const candidates = [unfenced];
    if (extracted && extracted !== unfenced) candidates.push(extracted);

    let parsed: any = null;
    for (const candidate of candidates) {
        try {
            parsed = JSON.parse(candidate);
            break;
        } catch {
            // Try next candidate
        }
    }

    if (parsed && typeof parsed === 'object') {
        const html = typeof parsed.html === 'string'
            ? parsed.html
            : (typeof parsed.HTML === 'string' ? parsed.HTML : null);

        const js = typeof parsed.js === 'string'
            ? parsed.js
            : (typeof parsed.javascript === 'string'
                ? parsed.javascript
                : (typeof parsed.JS === 'string' ? parsed.JS : null));

        if (html && js) {
            let files: GeneratedFile[] | undefined;
            if (Array.isArray(parsed.files)) {
                const normalized = parsed.files
                    .filter((entry: any) => entry && typeof entry.path === 'string' && typeof entry.content === 'string')
                    .map((entry: any) => ({ path: entry.path, content: entry.content }));
                if (normalized.length > 0) {
                    files = normalized;
                }
            }
            return { html, js, files };
        }
    }

    const htmlFence = rawContent.match(/```html\s*([\s\S]*?)\s*```/i)?.[1]?.trim();
    const jsFence = rawContent.match(/```(?:js|javascript)\s*([\s\S]*?)\s*```/i)?.[1]?.trim();

    if (htmlFence && jsFence) {
        return {
            html: htmlFence,
            js: jsFence
        };
    }

    throw new Error('Provider returned invalid JSON content. Ask the model to output strict JSON with "html" and "js" keys, or switch to a stronger model.');
}

function parsePatchResult(rawContent: string): PatchGenerationResult {
    const trimmed = rawContent.trim();
    const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    const unfenced = fencedMatch ? fencedMatch[1].trim() : trimmed;
    const extracted = extractFirstJSONObject(unfenced);
    const candidates = [unfenced];
    if (extracted && extracted !== unfenced) candidates.push(extracted);

    let parsed: any = null;
    for (const candidate of candidates) {
        try {
            parsed = JSON.parse(candidate);
            break;
        } catch {
            // Try next candidate.
        }
    }

    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.ops)) {
        return { ops: parsed.ops as PatchOp[] };
    }

    throw new Error('Provider returned invalid patch JSON content. Expected { "ops": [...] }.');
}

type ResponseFormatMode = 'json_schema' | 'json_object' | 'none';
type GenerationMode = 'full' | 'patch';

const FULL_OUTPUT_SCHEMA = {
    name: 'nanobuild_generation',
    strict: true,
    schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            html: { type: 'string' },
            js: { type: 'string' },
            files: {
                type: 'array',
                maxItems: 8,
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        path: { type: 'string' },
                        content: { type: 'string' }
                    },
                    required: ['path', 'content']
                }
            }
        },
        required: ['html', 'js']
    }
};

const PATCH_OUTPUT_SCHEMA = {
    name: 'nanobuild_patch_generation',
    strict: true,
    schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            ops: {
                type: 'array',
                minItems: 1,
                maxItems: 16,
                items: {
                    type: 'object',
                    properties: {
                        type: { type: 'string', enum: ['replace_range', 'insert_at', 'delete_range', 'replace_file'] },
                        path: { type: 'string' },
                        start: { type: 'integer' },
                        end: { type: 'integer' },
                        index: { type: 'integer' },
                        lines: {
                            type: 'array',
                            items: { type: 'string' }
                        },
                        content: { type: 'string' }
                    },
                    required: ['type', 'path'],
                    additionalProperties: false
                }
            }
        },
        required: ['ops']
    }
};

function shouldFallbackResponseFormat(status: number, errorText: string): boolean {
    if (status < 400 || status >= 500) return false;
    return /response_format|json_schema|unsupported|not support|invalid.*schema|unknown field|unrecognized/i.test(errorText);
}

function shouldFallbackStreaming(status: number, errorText: string): boolean {
    if (status < 400 || status >= 500) return false;
    return /stream|sse|event stream|unsupported|not support|invalid.*stream|unrecognized/i.test(errorText);
}

function buildCompletionBody(
    model: string,
    systemPrompt: string,
    prompt: string,
    temperature: number,
    mode: ResponseFormatMode,
    isOpenRouter: boolean,
    stream: boolean,
    generationMode: GenerationMode
): Record<string, any> {
    const body: Record<string, any> = {
        model,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt }
        ],
        temperature,
        stream
    };

    if (mode === 'json_schema') {
        body.response_format = {
            type: 'json_schema',
            json_schema: generationMode === 'patch' ? PATCH_OUTPUT_SCHEMA : FULL_OUTPUT_SCHEMA
        };
    } else if (mode === 'json_object') {
        body.response_format = { type: 'json_object' };
    }

    if (isOpenRouter) {
        body.route = 'fallback';
    }

    return body;
}

function normalizeCallbacks(input: GenerationCallbacks | ((message: string) => void)): GenerationCallbacks {
    if (typeof input === 'function') {
        return { onPhase: input };
    }
    return input;
}

function extractChunkText(chunk: any): string {
    const deltaContent = chunk?.choices?.[0]?.delta?.content;
    if (typeof deltaContent === 'string') return deltaContent;

    if (Array.isArray(deltaContent)) {
        return deltaContent
            .map((item: any) => (typeof item?.text === 'string' ? item.text : ''))
            .join('');
    }

    const messageContent = chunk?.choices?.[0]?.message?.content;
    if (typeof messageContent === 'string') return messageContent;

    if (Array.isArray(messageContent)) {
        return messageContent
            .map((item: any) => (typeof item?.text === 'string' ? item.text : ''))
            .join('');
    }

    if (typeof chunk?.response?.output_text === 'string') return chunk.response.output_text;
    return '';
}

async function readSseContent(response: Response, callbacks: GenerationCallbacks): Promise<string> {
    if (!response.body) {
        throw new Error('Streaming response body is empty.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let assembled = '';
    let done = false;

    while (!done) {
        const { value, done: readerDone } = await reader.read();
        if (readerDone) break;

        buffer += decoder.decode(value, { stream: true });
        let separatorIndex = buffer.indexOf('\n');
        while (separatorIndex !== -1) {
            const rawLine = buffer.slice(0, separatorIndex);
            buffer = buffer.slice(separatorIndex + 1);
            const line = rawLine.trim();

            if (!line.startsWith('data:')) {
                separatorIndex = buffer.indexOf('\n');
                continue;
            }

            const payload = line.slice(5).trim();
            if (!payload) {
                separatorIndex = buffer.indexOf('\n');
                continue;
            }
            if (payload === '[DONE]') {
                done = true;
                break;
            }

            try {
                const chunk = JSON.parse(payload);
                const delta = extractChunkText(chunk);
                if (delta) {
                    assembled += delta;
                    callbacks.onToken?.(delta);
                }
            } catch {
                // Ignore malformed stream chunks and keep parsing.
            }

            separatorIndex = buffer.indexOf('\n');
        }
    }

    callbacks.onComplete?.(assembled);
    return assembled.trim();
}

// Durable fetch with exponential backoff and timeout
async function durableFetch(url: string, options: RequestInit, retries = 3, backoff = 1000, timeoutMs = 30000): Promise<Response> {
    for (let attempt = 1; attempt <= retries; attempt++) {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });
            clearTimeout(id);

            // If it's a 5xx error or rate limit, retry. Otherwise, throw to short-circuit.
            if (!response.ok && (response.status >= 500 || response.status === 429)) {
                throw new Error(`API returned transient status ${response.status}`);
            }
            return response;

        } catch (error: any) {
            clearTimeout(id);
            const isAbort = error.name === 'AbortError';

            if (attempt === retries) {
                throw new Error(isAbort ? 'Inference provider timed out.' : error.message);
            }

            // Wait with exponential backoff before next attempt
            await new Promise(res => setTimeout(res, backoff * Math.pow(2, attempt - 1)));
        }
    }
    throw new Error('Unreachable durableFetch state');
}

/**
 * Interrogates the provider's /v1/models endpoint to fetch available models.
 */
export async function fetchAvailableModels(baseUrl: string, apiKey: string): Promise<string[]> {
    const normalized = normalizeBaseUrl(baseUrl);
    if (!normalized) return [];

    let endpoint = normalized;
    if (endpoint.endsWith('/chat/completions')) {
        endpoint = endpoint.replace(/\/chat\/completions$/, '');
    }
    if (!endpoint.endsWith('/v1')) {
        endpoint = `${endpoint}/v1`;
    }
    endpoint = `${endpoint}/models`;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    try {
        // Fast fail for model fetching (no retries, short timeout)
        const response = await durableFetch(endpoint, { method: 'GET', headers }, 1, 0, 5000);
        if (!response.ok) return [];

        const data = await response.json();
        if (data && Array.isArray(data.data)) {
            return data.data.map((m: any) => m.id).filter(Boolean);
        }
        return [];
    } catch (err) {
        console.warn('Failed to interrogate /v1/models', err);
        return [];
    }
}

async function generateFromEndpoint<T>(
    prompt: string,
    systemPrompt: string,
    callbacksInput: GenerationCallbacks | ((msg: string) => void),
    generationMode: GenerationMode
): Promise<T> {
    const callbacks = normalizeCallbacks(callbacksInput);
    const onPhase = callbacks.onPhase || (() => {});
    const settings = getSettings();

    // Format the endpoint according to OpenAI standard spec
    let endpoint = normalizeBaseUrl(settings.baseUrl);
    if (!endpoint) {
        throw new Error('Base API URL is required.');
    }

    if (!endpoint.endsWith('/chat/completions')) {
        if (!endpoint.endsWith('/v1')) {
            endpoint = `${endpoint}/v1`;
        }
        endpoint = `${endpoint}/chat/completions`;
    }

    const isOpenRouter = endpoint.includes('openrouter.ai');
    const isLocalEndpoint = isLocalHostUrl(endpoint);

    let selectedModel = (settings.model || '').trim();

    // Auto-heal stale model settings (for example legacy default "llama3" not installed in Ollama).
    try {
        const availableModels = await fetchAvailableModels(settings.baseUrl, settings.apiKey);
        if (availableModels.length > 0) {
            if (!selectedModel || !availableModels.includes(selectedModel)) {
                const previous = selectedModel;
                selectedModel = pickPreferredModel(availableModels);
                onPhase(previous
                    ? `Model "${previous}" not found. Using "${selectedModel}".`
                    : `Using detected model "${selectedModel}".`);

                localStorage.setItem('nanobuild-settings', JSON.stringify({
                    ...settings,
                    model: selectedModel
                }));
            }
        }
    } catch {
        // Ignore model interrogation errors here and continue with configured value.
    }

    if (!selectedModel) {
        throw new Error('No model selected. Open Settings and choose a model.');
    }

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };

    if (settings.apiKey) {
        headers['Authorization'] = `Bearer ${settings.apiKey}`;
    }

    if (isOpenRouter) {
        if (window.location.origin) headers['HTTP-Referer'] = window.location.origin;
        headers['X-Title'] = INFERENCE_CLIENT_TITLE;
    }

    // Local models often need much longer for full HTML+JS generation.
    const timeoutMs = isLocalEndpoint ? 300000 : 120000;
    const formatModes: ResponseFormatMode[] = ['json_schema', 'json_object', 'none'];

    const readResponseError = async (response: Response) => {
        let errorText = await response.text();
        try {
            const parsed = JSON.parse(errorText);
            if (parsed.error && parsed.error.message) {
                errorText = parsed.error.message;
            }
        } catch {
            // Keep raw error text.
        }
        return errorText;
    };

    const executeCompletion = async (mode: ResponseFormatMode, stream: boolean): Promise<string> => {
        const body = buildCompletionBody(
            selectedModel,
            systemPrompt,
            prompt,
            settings.temperature !== undefined ? Number(settings.temperature) : 0.2,
            mode,
            isOpenRouter,
            stream,
            generationMode
        );

        const response = await durableFetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
        }, 3, 1000, timeoutMs);

        if (!response.ok) {
            const errorText = await readResponseError(response);
            const err: any = new Error(`API error (${response.status}): ${errorText}`);
            err.status = response.status;
            err.errorText = errorText;
            throw err;
        }

        if (stream) {
            const streamedContent = await readSseContent(response, callbacks);
            if (!streamedContent) {
                throw new Error('Streaming provider returned empty content.');
            }
            return streamedContent;
        }

        onPhase('Processing response...');
        const data = await response.json();
        const content = extractTextContent(data.choices?.[0]?.message?.content);
        if (!content) {
            throw new Error('Invalid response format from provider');
        }
        callbacks.onComplete?.(content);
        return content;
    };

    try {
        onPhase(`Contacting model ${selectedModel}...`);
        const startedAt = Date.now();
        const heartbeat = window.setInterval(() => {
            const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
            onPhase(`Generating with ${selectedModel}... ${elapsedSec}s`);
        }, 2000);

        try {
            for (let i = 0; i < formatModes.length; i++) {
                const mode = formatModes[i];
                const modeLabel = mode === 'none' ? 'plain mode' : mode;
                onPhase(`Generating response with ${selectedModel} (${modeLabel})...`);

                let content = '';
                try {
                    content = await executeCompletion(mode, true);
                } catch (streamErr: any) {
                    const status = typeof streamErr?.status === 'number' ? streamErr.status : 0;
                    const errorText = typeof streamErr?.errorText === 'string' ? streamErr.errorText : streamErr?.message || '';
                    if (status && i < formatModes.length - 1 && shouldFallbackResponseFormat(status, errorText)) {
                        onPhase(`Provider rejected ${modeLabel}. Retrying with a fallback format...`);
                        continue;
                    }

                    if (!status || shouldFallbackStreaming(status, errorText)) {
                        onPhase('Streaming unavailable for this provider mode. Falling back to standard response...');
                        content = await executeCompletion(mode, false);
                    } else {
                        throw streamErr;
                    }
                }

                try {
                    return (generationMode === 'patch'
                        ? parsePatchResult(content)
                        : parseGenerationResult(content)) as T;
                } catch (parseErr: any) {
                    if (i < formatModes.length - 1) {
                        onPhase(`Could not parse ${modeLabel} output. Retrying with fallback format...`);
                        continue;
                    }
                    throw parseErr;
                }
            }

            throw new Error(generationMode === 'patch'
                ? 'Provider did not return valid structured patch ops.'
                : 'Provider did not return a valid structured app payload.');
        } finally {
            window.clearInterval(heartbeat);
        }
    } catch (err: any) {
        let message = err?.message || 'Unknown inference error.';
        if (/failed to fetch|networkerror/i.test(message)) {
            message = 'Network request failed. This is usually CORS or an invalid endpoint URL. OpenRouter generally works from browser clients, while local providers may need CORS enabled or a proxy.';
        }
        console.error('Inference Error:', err);
        onPhase('Error connecting to Inference Provider: ' + message);
        throw new Error(message);
    }
}

export async function generateAppFromEndpoint(
    prompt: string,
    systemPrompt: string,
    callbacksInput: GenerationCallbacks | ((msg: string) => void)
): Promise<GenerationResult> {
    return generateFromEndpoint<GenerationResult>(prompt, systemPrompt, callbacksInput, 'full');
}

export async function generatePatchFromEndpoint(
    prompt: string,
    systemPrompt: string,
    callbacksInput: GenerationCallbacks | ((msg: string) => void)
): Promise<PatchGenerationResult> {
    return generateFromEndpoint<PatchGenerationResult>(prompt, systemPrompt, callbacksInput, 'patch');
}
