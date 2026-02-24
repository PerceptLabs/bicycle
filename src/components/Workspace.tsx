import { useState } from 'preact/hooks';
import { ChatPanel } from './ChatPanel';
import { EditorPanel } from './EditorPanel';
import { PreviewPanel } from './PreviewPanel';
import { ProjectControls } from './ProjectControls';

export function Workspace() {
    const [activeTab, setActiveTab] = useState<'preview' | 'code'>('preview');

    return (
        <div className="flex w-full h-full bg-base-300 gap-2 p-2">
            {/* Left Sidebar: Chat/Loop Control */}
            <div className="w-80 flex flex-col gap-2 rounded-xl overflow-hidden glass-panel h-full shadow-lg border border-base-200/50 relative z-10">
                <ChatPanel />
            </div>

            {/* Main Area: Preview & Code Editor */}
            <div className="flex-1 flex flex-col min-w-0 bg-base-100/50 rounded-xl overflow-hidden shadow-inner ring-1 ring-base-content/5 relative">
                <div className="flex items-center justify-between px-4 py-2 bg-base-200/50 border-b border-base-content/10 backdrop-blur-md gap-3">
                    <div className="tabs tabs-boxed bg-base-300/50 p-1">
                        <a
                            className={`tab tab-sm ${activeTab === 'preview' ? 'tab-active' : ''} transition-all duration-300`}
                            onClick={() => setActiveTab('preview')}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5"><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18" /><path d="m9 21-3-9" /></svg>
                            Preview
                        </a>
                        <a
                            className={`tab tab-sm ${activeTab === 'code' ? 'tab-active' : ''} transition-all duration-300`}
                            onClick={() => setActiveTab('code')}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5"><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>
                            Code
                        </a>
                    </div>
                    <div className="flex items-center gap-3 min-w-0">
                        <ProjectControls />
                        <div className="badge badge-success badge-sm gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
                            Online
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-hidden relative">
                    <div className={`absolute inset-0 transition-opacity duration-300 ${activeTab === 'preview' ? 'opacity-100 z-10' : 'opacity-0 z-0'}`}>
                        <PreviewPanel />
                    </div>
                    <div className={`absolute inset-0 transition-opacity duration-300 ${activeTab === 'code' ? 'opacity-100 z-10' : 'opacity-0 z-0'}`}>
                        <EditorPanel />
                    </div>
                </div>
            </div>
        </div>
    );
}
