import { useEffect, useState } from 'preact/hooks';
import { Workspace } from './components/Workspace';
import { initializeEditorLoop } from './loop';
import { APP_BRAND } from './config/brand';
import type { ComponentType } from 'preact';

type SettingsModalProps = {
  onClose: () => void;
};

export function App() {
  const [showSettings, setShowSettings] = useState(false);
  const [SettingsModalComponent, setSettingsModalComponent] = useState<ComponentType<SettingsModalProps> | null>(null);

  useEffect(() => {
    initializeEditorLoop();
  }, []);

  useEffect(() => {
    if (!showSettings || SettingsModalComponent) return;
    let cancelled = false;
    import('./components/SettingsModal').then((mod) => {
      if (cancelled) return;
      setSettingsModalComponent(() => mod.SettingsModal);
    });
    return () => {
      cancelled = true;
    };
  }, [showSettings, SettingsModalComponent]);

  return (
    <div data-theme="dark" className="h-[100dvh] w-screen overflow-hidden bg-base-300 text-base-content flex flex-col font-sans">
      {/* Top Navbar */}
      <div className="navbar bg-base-100 min-h-12 h-12 border-b border-base-200 shadow-sm z-10 px-4">
        <div className="flex-1">
          <a className="text-lg font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary"><circle cx="6" cy="17" r="3" /><circle cx="18" cy="17" r="3" /><path d="M6 17h4l3-7h3" /><path d="M10 10l2 7" /><path d="M13 10h-3" /></svg>
            {APP_BRAND}
          </a>
        </div>
        <div className="flex-none gap-2">
          <button className="btn btn-sm btn-ghost btn-circle" onClick={() => setShowSettings(true)} title="Settings">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
          </button>
        </div>
      </div>

      {/* Main Workspace Area */}
      <main className="flex-1 flex overflow-hidden">
        <Workspace />
      </main>

      {showSettings && SettingsModalComponent && <SettingsModalComponent onClose={() => setShowSettings(false)} />}
    </div>
  )
}
