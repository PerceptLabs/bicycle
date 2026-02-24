import { useEffect, useRef, useState } from 'preact/hooks';
import { runIterationLoop, type LoopUpdateEvent } from '../loop';
import { buildShareableDiagnostics, getDiagnosticsChangedEventName, getProjectDiagnostics } from '../core/diagnostics';
import { getCurrentProjectId, getProjectsChangedEventName } from '../core/projects';

type ConversationStatus = 'pending' | 'success' | 'error';

interface ConversationEntry {
    kind: 'conversation';
    id: string;
    role: 'user' | 'assistant';
    content: string;
    status?: ConversationStatus;
}

interface ActionEntry {
    kind: 'action';
    id: string;
    steps: string[];
}

interface ArtifactEntry {
    kind: 'artifact';
    id: string;
    title: string;
    content: string;
    expanded: boolean;
    status: ConversationStatus;
    tokenCount: number;
    iteration?: number;
    splitFallbackUsed?: boolean;
}

type TimelineEntry = ConversationEntry | ActionEntry | ArtifactEntry;

const STREAM_FLUSH_MS = 60;
const MAX_ACTION_STEPS = 14;

function countWordTokens(input: string): number {
    const trimmed = input.trim();
    if (!trimmed) return 0;
    return trimmed.split(/\s+/).length;
}

function appendStep(existing: string[], next: string): string[] {
    const trimmed = next.trim();
    if (!trimmed) return existing;
    if (existing[existing.length - 1] === trimmed) return existing;
    const nextSteps = [...existing, trimmed];
    if (nextSteps.length <= MAX_ACTION_STEPS) return nextSteps;
    return nextSteps.slice(nextSteps.length - MAX_ACTION_STEPS);
}

function updateEntry(entries: TimelineEntry[], id: string, updater: (entry: TimelineEntry) => TimelineEntry): TimelineEntry[] {
    return entries.map(entry => (entry.id === id ? updater(entry) : entry));
}

export function ChatPanel() {
    const [timeline, setTimeline] = useState<TimelineEntry[]>([
        {
            kind: 'conversation',
            id: 'intro-assistant',
            role: 'assistant',
            content: 'Describe the product you want to build. I will generate it and apply updates.'
        }
    ]);
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [latestIssue, setLatestIssue] = useState<string>('');
    const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');
    const bottomRef = useRef<HTMLDivElement>(null);

    const tokenBufferRef = useRef<Record<string, string>>({});
    const tokenTimerRef = useRef<Record<string, number>>({});

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [timeline, isTyping]);

    useEffect(() => {
        const refreshIssue = () => {
            const entries = getProjectDiagnostics(getCurrentProjectId(), 30)
                .filter(entry => entry.level === 'error' || entry.level === 'warn');
            const latest = entries.length > 0 ? entries[entries.length - 1] : null;
            setLatestIssue(latest ? latest.message : '');
        };
        refreshIssue();

        window.addEventListener(getDiagnosticsChangedEventName(), refreshIssue);
        window.addEventListener(getProjectsChangedEventName(), refreshIssue);
        return () => {
            window.removeEventListener(getDiagnosticsChangedEventName(), refreshIssue);
            window.removeEventListener(getProjectsChangedEventName(), refreshIssue);
        };
    }, []);

    useEffect(() => {
        return () => {
            Object.values(tokenTimerRef.current).forEach(id => window.clearTimeout(id));
        };
    }, []);

    const copyDebugReport = async () => {
        const text = buildShareableDiagnostics(getCurrentProjectId());
        try {
            await navigator.clipboard.writeText(text);
            setCopyState('copied');
            window.setTimeout(() => setCopyState('idle'), 1200);
        } catch {
            setCopyState('idle');
        }
    };

    const flushTokenBuffer = (artifactId: string) => {
        if (tokenTimerRef.current[artifactId]) {
            window.clearTimeout(tokenTimerRef.current[artifactId]);
            tokenTimerRef.current[artifactId] = 0;
        }
        const buffered = tokenBufferRef.current[artifactId];
        if (!buffered) return;
        tokenBufferRef.current[artifactId] = '';

        setTimeline(prev => updateEntry(prev, artifactId, entry => {
            if (entry.kind !== 'artifact') return entry;
            return {
                ...entry,
                content: `${entry.content}${buffered}`
            };
        }));
    };

    const enqueueArtifactToken = (artifactId: string, delta: string) => {
        if (!delta) return;
        tokenBufferRef.current[artifactId] = `${tokenBufferRef.current[artifactId] || ''}${delta}`;
        if (tokenTimerRef.current[artifactId]) return;
        tokenTimerRef.current[artifactId] = window.setTimeout(() => flushTokenBuffer(artifactId), STREAM_FLUSH_MS);
    };

    const applyLoopEvent = (
        ids: { narrativeId: string; actionId: string; artifactId: string },
        event: LoopUpdateEvent
    ) => {
        if (event.channel === 'artifact' && event.type === 'token') {
            enqueueArtifactToken(ids.artifactId, event.token || '');
            const tokenDelta = typeof event.tokenCount === 'number' ? 0 : countWordTokens(event.token || '');
            setTimeline(prev => updateEntry(prev, ids.artifactId, entry => {
                if (entry.kind !== 'artifact') return entry;
                return {
                    ...entry,
                    tokenCount: typeof event.tokenCount === 'number' ? event.tokenCount : entry.tokenCount + tokenDelta,
                    iteration: event.iteration ?? entry.iteration,
                    splitFallbackUsed: typeof event.splitFallbackUsed === 'boolean' ? event.splitFallbackUsed : entry.splitFallbackUsed
                };
            }));
            return;
        }

        const message = (event.message || '').trim();
        if (!message) return;

        if (event.channel === 'artifact') {
            enqueueArtifactToken(ids.artifactId, `${message}\n`);
            setTimeline(prev => updateEntry(prev, ids.artifactId, entry => {
                if (entry.kind !== 'artifact') return entry;
                return {
                    ...entry,
                    tokenCount: typeof event.tokenCount === 'number' ? event.tokenCount : entry.tokenCount,
                    iteration: event.iteration ?? entry.iteration,
                    splitFallbackUsed: typeof event.splitFallbackUsed === 'boolean' ? event.splitFallbackUsed : entry.splitFallbackUsed
                };
            }));
            return;
        }

        if (event.channel === 'narrative') {
            setTimeline(prev => updateEntry(prev, ids.narrativeId, entry => {
                if (entry.kind !== 'conversation') return entry;
                return {
                    ...entry,
                    content: message
                };
            }));
            return;
        }

        setTimeline(prev => updateEntry(prev, ids.actionId, entry => {
            if (entry.kind !== 'action') return entry;
            return {
                ...entry,
                steps: appendStep(entry.steps, message)
            };
        }));
    };

    const setPendingOutcome = (ids: { narrativeId: string; artifactId: string }, ok: boolean) => {
        setTimeline(prev => {
            let next = updateEntry(prev, ids.artifactId, entry => {
                if (entry.kind !== 'artifact') return entry;
                return {
                    ...entry,
                    status: ok ? 'success' : 'error'
                };
            });
            next = updateEntry(next, ids.narrativeId, entry => {
                if (entry.kind !== 'conversation') return entry;
                return {
                    ...entry,
                    status: ok ? 'success' : 'error'
                };
            });
            return next;
        });
    };

    const handleSubmit = async (e: Event) => {
        e.preventDefault();
        if (!input.trim() || isTyping) return;

        const currentInput = input;
        const baseId = `${Date.now()}`;
        const ids = {
            narrativeId: `${baseId}-assistant`,
            actionId: `${baseId}-actions`,
            artifactId: `${baseId}-artifact`
        };

        const newEntries: TimelineEntry[] = [
            { kind: 'conversation', id: `${baseId}-user`, role: 'user', content: currentInput },
            {
                kind: 'conversation',
                id: ids.narrativeId,
                role: 'assistant',
                content: 'Working on your update.',
                status: 'pending'
            },
            {
                kind: 'action',
                id: ids.actionId,
                steps: ['Queued request...']
            },
            {
                kind: 'artifact',
                id: ids.artifactId,
                title: 'Generation Stream',
                content: '',
                expanded: false,
                status: 'pending',
                tokenCount: 0,
                splitFallbackUsed: false
            }
        ];

        setTimeline(prev => [...prev, ...newEntries]);
        setInput('');
        setIsTyping(true);

        const result = await runIterationLoop(currentInput, (event) => applyLoopEvent(ids, event));
        flushTokenBuffer(ids.artifactId);

        setTimeline(prev => updateEntry(prev, ids.narrativeId, entry => {
            if (entry.kind !== 'conversation') return entry;
            const fallbackSummary = result.ok
                ? `Applied in ${result.appliedIteration || 1} pass(es).${typeof result.riskCount === 'number' ? ` Readability risks: ${result.riskCount}.` : ''}`
                : `Update failed: ${result.error || 'Unknown error.'}`;
            return {
                ...entry,
                content: entry.content || fallbackSummary,
                status: result.ok ? 'success' : 'error'
            };
        }));
        setPendingOutcome(ids, result.ok);
        setIsTyping(false);
    };

    const toggleArtifactExpanded = (id: string) => {
        setTimeline(prev => updateEntry(prev, id, entry => {
            if (entry.kind !== 'artifact') return entry;
            return { ...entry, expanded: !entry.expanded };
        }));
    };

    return (
        <div className="flex flex-col h-full bg-base-100/40">
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {timeline.map(entry => {
                    if (entry.kind === 'conversation') {
                        const isUser = entry.role === 'user';
                        return (
                            <div key={entry.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                                <div
                                    className={`max-w-[290px] rounded-xl px-3 py-2 text-sm shadow-sm ${
                                        isUser
                                            ? 'bg-primary text-primary-content'
                                            : 'bg-secondary/90 text-secondary-content'
                                    }`}
                                >
                                    {entry.content}
                                    {entry.status === 'pending' && (
                                        <div className="mt-2 flex items-center gap-1 text-[11px] opacity-80">
                                            <span className="loading loading-dots loading-xs"></span>
                                            Working...
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    }

                    if (entry.kind === 'action') {
                        return (
                            <div key={entry.id} className="rounded-lg border border-base-content/10 bg-base-200/35 px-3 py-2">
                                <div className="text-[11px] uppercase tracking-wide opacity-60 mb-1">Build Timeline</div>
                                <div className="space-y-1">
                                    {entry.steps.map((step, index) => (
                                        <div key={`${entry.id}-${index}`} className="text-[11px] opacity-80 truncate">
                                            {step}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    }

                    const charCount = entry.content.length;
                    return (
                        <div key={entry.id} className="rounded-lg border border-base-content/15 bg-base-200/50 overflow-hidden">
                            <button
                                type="button"
                                className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-base-200/70 transition-colors"
                                onClick={() => toggleArtifactExpanded(entry.id)}
                            >
                                <div>
                                    <div className="text-xs font-semibold">{entry.title}</div>
                                    <div className="text-[11px] opacity-60">
                                        {charCount.toLocaleString()} chars
                                    </div>
                                    <div className="text-[11px] opacity-60">
                                        {`Pass ${entry.iteration ?? '-'} | ${entry.tokenCount.toLocaleString()} tokens`}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    {entry.status === 'pending' && <span className="loading loading-spinner loading-xs"></span>}
                                    <span className="text-xs opacity-60">{entry.expanded ? 'Collapse' : 'Expand'}</span>
                                </div>
                            </button>
                            {entry.expanded && (
                                <div className="border-t border-base-content/10 bg-base-100/70">
                                    <pre className="max-h-52 overflow-auto px-3 py-2 text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-all">
                                        {entry.content || 'No stream output yet.'}
                                    </pre>
                                </div>
                            )}
                        </div>
                    );
                })}
                <div ref={bottomRef} />
            </div>

            <div className="p-3 bg-base-200/80 backdrop-blur-sm border-t border-base-300 shrink-0">
                <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="text-[11px] opacity-70 truncate">
                        {latestIssue ? `Latest issue: ${latestIssue}` : 'No captured runtime issues'}
                    </p>
                    <button className="btn btn-ghost btn-xs h-6 min-h-6 px-2" onClick={copyDebugReport}>
                        {copyState === 'copied' ? 'Copied' : 'Copy Debug'}
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="relative">
                    <input
                        type="text"
                        value={input}
                        onInput={(e) => setInput(e.currentTarget.value)}
                        placeholder="Describe your requested change..."
                        className="input input-bordered w-full pr-12 bg-base-100 focus:outline-none focus:ring-1 focus:ring-primary shadow-inner text-sm"
                        disabled={isTyping}
                    />
                    <button
                        type="submit"
                        className="btn btn-sm btn-circle btn-primary absolute right-1.5 top-1.5"
                        disabled={!input.trim() || isTyping}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" x2="11" y1="2" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                    </button>
                </form>
            </div>
        </div>
    );
}
