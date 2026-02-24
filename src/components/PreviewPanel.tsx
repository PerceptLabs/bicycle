import { useState, useEffect, useRef } from 'preact/hooks';
import { getCurrentProjectId, getProjectsChangedEventName } from '../core/projects';
import { addDiagnostic } from '../core/diagnostics';

function parsePreviewFilePath(filename: unknown): string | undefined {
    if (!filename || typeof filename !== 'string') return undefined;
    try {
        const url = new URL(filename, window.location.origin);
        const parts = url.pathname.split('/').filter(Boolean);
        if (parts[0] === 'preview' && parts.length >= 3) {
            return `/${parts.slice(2).join('/')}`;
        }
    } catch {
        const match = filename.match(/\/preview\/[^/]+(\/[^:\s]+)(?::\d+)?(?::\d+)?/);
        if (match) return match[1];
    }
    return undefined;
}

function inferPreviewErrorKind(message: string): 'syntax' | 'runtime' {
    return /syntaxerror|unexpected token|invalid or unexpected token/i.test(message) ? 'syntax' : 'runtime';
}

export function PreviewPanel() {
    const [reloadKey, setReloadKey] = useState(0);
    const [projectId, setProjectId] = useState(getCurrentProjectId());
    const iframeRef = useRef<HTMLIFrameElement>(null);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (event.data?.type === 'RELOAD') {
                setReloadKey(prev => prev + 1);
                return;
            }

            const isFromPreview = event.source === iframeRef.current?.contentWindow;
            if (!isFromPreview) return;

            if (event.data?.source === 'nanobuild-preview') {
                const projectId = getCurrentProjectId();
                const type = event.data.type;
                const payload = event.data.payload || {};

                if (type === 'runtime-error') {
                    const filePath = parsePreviewFilePath(payload.filename);
                    const line = typeof payload.lineno === 'number' ? payload.lineno : undefined;
                    const column = typeof payload.colno === 'number' ? payload.colno : undefined;
                    const message = payload.message || 'Runtime error';
                    addDiagnostic({
                        projectId,
                        source: 'preview',
                        level: 'error',
                        message,
                        details: `${payload.filename || ''}:${payload.lineno || ''}:${payload.colno || ''}\n${payload.stack || ''}`.trim(),
                        filePath,
                        line,
                        column,
                        errorKind: inferPreviewErrorKind(message)
                    });
                    return;
                }

                if (type === 'unhandled-rejection') {
                    addDiagnostic({
                        projectId,
                        source: 'preview',
                        level: 'error',
                        message: 'Unhandled promise rejection',
                        details: payload.reason || '',
                        errorKind: 'runtime'
                    });
                    return;
                }

                if (type === 'console') {
                    const level = payload.level;
                    if (level === 'error' || level === 'warn') {
                        addDiagnostic({
                            projectId,
                            source: 'preview',
                            level,
                            message: Array.isArray(payload.args) ? payload.args.join(' ') : String(payload.args || ''),
                            errorKind: 'runtime'
                        });
                    }
                }
            }
        };

        navigator.serviceWorker?.addEventListener('message', handleMessage);

        // Also listen on window in case SW broadcasts there
        window.addEventListener('message', handleMessage);
        const handleProjectChanged = () => {
            setProjectId(getCurrentProjectId());
            setReloadKey(prev => prev + 1);
        };
        window.addEventListener(getProjectsChangedEventName(), handleProjectChanged);

        return () => {
            navigator.serviceWorker?.removeEventListener('message', handleMessage);
            window.removeEventListener('message', handleMessage);
            window.removeEventListener(getProjectsChangedEventName(), handleProjectChanged);
        };
    }, []);

    const handleManualReload = () => setReloadKey(prev => prev + 1);

    return (
        <div className="flex flex-col h-full bg-base-100 rounded-lg overflow-hidden relative">
            {/* Browser Bar */}
            <div className="h-10 bg-base-300 border-b border-base-content/10 flex items-center px-4 gap-3 shrink-0">

                <div className="flex-1 flex justify-center">
                    <div className="bg-base-100/50 backdrop-blur-sm shadow-inner rounded-full px-4 py-1 text-xs text-base-content/60 flex items-center gap-2 w-full max-w-md border border-base-content/5">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                        {`localhost:4500/preview/${projectId}/index.html`}
                    </div>
                </div>

                <button onClick={handleManualReload} className="btn btn-ghost btn-xs btn-circle text-base-content/60 hover:text-primary">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`${reloadKey % 2 === 0 ? '' : 'transition-transform duration-500 rotate-180'}`}><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
                </button>
            </div>

            {/* Iframe container */}
            <div className="flex-1 bg-white relative">
                <iframe
                    key={`${projectId}:${reloadKey}`}
                    ref={iframeRef}
                    src={`/preview/${encodeURIComponent(projectId)}/index.html`}
                    className="w-full h-full border-0 absolute inset-0"
                    title="App Preview"
                />
            </div>
        </div>
    );
}
