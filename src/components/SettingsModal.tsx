import { useState, useEffect } from 'preact/hooks';
import { fetchAvailableModels } from '../utils/ai';
import { resetWorkspace } from '../core/fs';
import { APP_BRAND } from '../config/brand';

export interface AISettings {
    baseUrl: string;
    apiKey: string;
    model: string;
    temperature: number;
}

export const PRESET_PROVIDERS = [
    { name: 'Ollama (Local)', url: 'http://localhost:11434/v1', key: '' },
    { name: 'LM Studio (Local)', url: 'http://localhost:1234/v1', key: '' },
    { name: 'OpenRouter (Cloud)', url: 'https://openrouter.ai/api/v1', key: '' }
];

export const DEFAULT_SETTINGS: AISettings = {
    baseUrl: PRESET_PROVIDERS[0].url,
    apiKey: '',
    model: '',
    temperature: 0.2
};

export function getSettings(): AISettings {
    try {
        const saved = localStorage.getItem('nanobuild-settings');
        if (saved) {
            // ensure temperature is populated for backward compat
            const parsed = JSON.parse(saved);
            if (typeof parsed.temperature !== 'number') parsed.temperature = 0.2;
            return {
                baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : DEFAULT_SETTINGS.baseUrl,
                apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : DEFAULT_SETTINGS.apiKey,
                model: typeof parsed.model === 'string' ? parsed.model : DEFAULT_SETTINGS.model,
                temperature: parsed.temperature
            };
        }
    } catch (e) {
        console.error('Failed to parse settings', e);
    }
    return DEFAULT_SETTINGS;
}

interface SettingsModalProps {
    onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
    const [settings, setSettings] = useState<AISettings>(getSettings());
    const [isSaved, setIsSaved] = useState(false);

    // Model Interrogation State
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [isFetchingModels, setIsFetchingModels] = useState(false);

    // Fetch models whenever the URL or Key changes, after a short debounce
    useEffect(() => {
        const timeoutId = setTimeout(async () => {
            if (!settings.baseUrl) return;
            setIsFetchingModels(true);
            const models = await fetchAvailableModels(settings.baseUrl, settings.apiKey);
            setAvailableModels(models);
            const pickPreferredModel = (items: string[]) => {
                const isCloudModel = (id: string) => /(:cloud|-cloud)(:|$)/i.test(id);
                const isEmbeddingModel = (id: string) => /embed/i.test(id);
                return items.find(id => !isCloudModel(id) && !isEmbeddingModel(id))
                    || items.find(id => !isCloudModel(id))
                    || items[0];
            };

            // If the current model is invalid, pick a sensible default from discovered models.
            if (models.length > 0 && !models.includes(settings.model)) {
                setSettings(s => ({ ...s, model: pickPreferredModel(models) }));
            }

            setIsFetchingModels(false);
        }, 500);

        return () => clearTimeout(timeoutId);
    }, [settings.baseUrl, settings.apiKey]);

    const handleSave = () => {
        localStorage.setItem('nanobuild-settings', JSON.stringify(settings));
        setIsSaved(true);
        setTimeout(() => {
            setIsSaved(false);
            onClose();
        }, 1000);
    };

    const applyPreset = (url: string, key: string) => {
        setSettings({ ...settings, baseUrl: url, apiKey: key });
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
            <div className="bg-base-100 rounded-2xl p-6 w-full max-w-lg shadow-2xl border border-base-200 relative max-h-[90vh] overflow-y-auto">
                <button
                    className="btn btn-sm btn-circle btn-ghost absolute right-2 top-2"
                    onClick={onClose}
                >x</button>
                <h3 className="font-bold text-lg text-primary flex items-center gap-2 mb-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
                    Inference Connectivity
                </h3>

                <p className="py-2 text-sm opacity-80 mb-4 whitespace-normal">Select a preset or configure a custom OpenAI-compatible endpoint. {APP_BRAND} needs an endpoint capable of JSON generation.</p>

                {/* Presets Row */}
                <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
                    {PRESET_PROVIDERS.map(p => (
                        <button
                            key={p.name}
                            className={`btn btn-xs ${settings.baseUrl === p.url ? 'btn-primary' : 'btn-outline border-base-content/20'}`}
                            onClick={() => applyPreset(p.url, p.key)}
                        >
                            {p.name}
                        </button>
                    ))}
                    <button
                        className={`btn btn-xs ${!PRESET_PROVIDERS.find(p => p.url === settings.baseUrl) ? 'btn-primary' : 'btn-outline border-base-content/20'}`}
                        onClick={() => applyPreset('', '')}
                    >
                        Custom Setup
                    </button>
                </div>

                <div className="form-control w-full space-y-4">
                    <div className="bg-base-200/50 p-4 rounded-xl border border-base-content/5 space-y-3">
                        <div>
                            <label className="label pt-0"><span className="label-text font-medium">Base API URL</span></label>
                            <input
                                type="text"
                                placeholder="http://localhost:11434/v1"
                                className="input input-sm input-bordered w-full font-mono text-sm bg-base-100 placeholder:text-base-content/30"
                                value={settings.baseUrl}
                                onInput={(e) => setSettings({ ...settings, baseUrl: e.currentTarget.value })}
                            />
                        </div>

                        <div>
                            <label className="label"><span className="label-text font-medium">API Key <span className="opacity-50 text-xs font-normal">(Optional for local)</span></span></label>
                            <input
                                type="password"
                                placeholder="sk-..."
                                className="input input-sm input-bordered w-full font-mono text-sm bg-base-100 placeholder:text-base-content/30"
                                value={settings.apiKey}
                                onInput={(e) => setSettings({ ...settings, apiKey: e.currentTarget.value })}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="label">
                                <span className="label-text font-medium flex items-center gap-2">
                                    Model
                                    {isFetchingModels && <span className="loading loading-spinner loading-xs text-primary"></span>}
                                </span>
                            </label>

                            {availableModels.length > 0 ? (
                                <select
                                    className="select select-sm select-bordered w-full font-mono text-sm shadow-inner truncate"
                                    value={settings.model}
                                    onChange={(e) => setSettings({ ...settings, model: e.currentTarget.value })}
                                >
                                    {availableModels.map(m => (
                                        <option key={m} value={m}>{m}</option>
                                    ))}
                                </select>
                            ) : (
                                <input
                                    type="text"
                                    placeholder="llama3"
                                    className="input input-sm input-bordered w-full font-mono text-sm shadow-inner"
                                    value={settings.model}
                                    onInput={(e) => setSettings({ ...settings, model: e.currentTarget.value })}
                                />
                            )}
                        </div>

                        <div>
                            <label className="label">
                                <span className="label-text font-medium">Temperature: {settings.temperature}</span>
                            </label>
                            <input
                                type="range"
                                min="0"
                                max="2"
                                step="0.1"
                                value={settings.temperature}
                                className="range range-xs range-primary mt-2"
                                onInput={(e) => setSettings({ ...settings, temperature: parseFloat(e.currentTarget.value) })}
                            />
                            <div className="w-full flex justify-between text-[10px] px-1 mt-1 opacity-50">
                                <span>Precise</span>
                                <span>Creative</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="modal-action mt-6 border-t border-base-200 pt-4 flex justify-between items-center">
                    <button className="btn btn-error btn-outline btn-sm" onClick={async () => {
                        await resetWorkspace();
                        window.location.reload(); // Full reload to reconstruct LightningFS
                    }}>Reset Workspace</button>
                    <div className="flex gap-2">
                        <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
                        <button className={`btn btn-primary btn-sm ${isSaved ? 'btn-success text-white' : ''}`} onClick={handleSave}>
                            {isSaved ? 'Configs Saved!' : 'Save & Apply'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

