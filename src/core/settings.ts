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

const SETTINGS_KEY = 'nanobuild-settings';

export function getSettings(): AISettings {
    try {
        const saved = localStorage.getItem(SETTINGS_KEY);
        if (saved) {
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

export function saveSettings(settings: AISettings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

