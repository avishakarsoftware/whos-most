import { useEffect } from 'react';
import { VIBE_CATEGORIES, type VibeId } from '../../types';

export interface AIProvider {
    id: string;
    name: string;
    description: string;
    available: boolean;
}

interface PromptScreenProps {
    vibe: VibeId;
    setVibe: (v: VibeId) => void;
    customTheme: string;
    setCustomTheme: (v: string) => void;
    numPrompts: number;
    setNumPrompts: (v: number) => void;
    provider: string;
    setProvider: (v: string) => void;
    providers: AIProvider[];
    onGenerate: () => void;
}

const PROVIDER_ICONS: Record<string, string> = {
    ollama: '🦙',
    gemini: '✨',
    claude: '🤖',
};

export default function PromptScreen({
    vibe, setVibe, customTheme, setCustomTheme,
    numPrompts, setNumPrompts, provider, setProvider,
    providers, onGenerate,
}: PromptScreenProps) {

    useEffect(() => {
        if (!vibe) setVibe('party');
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const canGenerate = vibe !== 'custom' || customTheme.trim().length > 0;

    return (
        <div className="min-h-dvh flex flex-col container-responsive safe-top safe-bottom animate-in">
            <div className="flex-1 flex flex-col justify-center py-8">
                {/* Hero header */}
                <div className="text-center mb-8">
                    <div className="hero-icon mb-4">🎉</div>
                    <h1 className="hero-title">Who's Most</h1>
                    <p style={{ color: 'var(--color-text-secondary)', marginTop: 8 }}>Pick a vibe for your prompts</p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {/* Vibe selector grid */}
                    <div>
                        <p className="section-header" style={{ marginBottom: 8 }}>Vibe</p>
                        <div className="vibe-grid">
                            {VIBE_CATEGORIES.map((cat) => (
                                <button
                                    key={cat.id}
                                    onClick={() => setVibe(cat.id)}
                                    className={`vibe-card ${vibe === cat.id ? 'selected' : ''}`}
                                >
                                    <span style={{ fontSize: '1.5rem' }}>{cat.emoji}</span>
                                    <span style={{ fontWeight: 600, fontSize: 14 }}>{cat.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Custom theme input */}
                    {vibe === 'custom' && (
                        <div>
                            <textarea
                                value={customTheme}
                                onChange={(e) => setCustomTheme(e.target.value.slice(0, 300))}
                                placeholder="Describe your vibe... e.g. 'College roommates who love hiking'"
                                className="input-field input-large"
                                maxLength={300}
                            />
                            <div style={{ fontSize: 12, textAlign: 'right', marginTop: 4, color: customTheme.length > 250 ? 'var(--color-danger)' : 'var(--color-text-secondary)' }}>
                                {customTheme.length}/300
                            </div>
                        </div>
                    )}

                    {/* AI Provider selector */}
                    {providers.length > 0 && (
                        <div>
                            <p className="section-header" style={{ marginBottom: 8 }}>AI Provider</p>
                            <div className="provider-selector">
                                {providers.map((p) => (
                                    <button
                                        key={p.id}
                                        onClick={() => p.available && setProvider(p.id)}
                                        className={`provider-option ${provider === p.id ? 'active' : ''} ${!p.available ? 'unavailable' : ''}`}
                                        disabled={!p.available}
                                    >
                                        <span style={{ fontSize: '1.125rem' }}>{PROVIDER_ICONS[p.id] || '🧠'}</span>
                                        <span className="provider-name">{p.name}</span>
                                        {!p.available && <span className="provider-badge">{p.id === 'ollama' ? 'Offline' : 'No key'}</span>}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Prompt count */}
                    <div>
                        <p className="section-header" style={{ marginBottom: 8 }}>Prompts</p>
                        <div className="time-preset-selector">
                            {[3, 5, 10, 20].map((n) => (
                                <button
                                    key={n}
                                    onClick={() => setNumPrompts(n)}
                                    className={`time-preset-option ${numPrompts === n ? 'active' : ''}`}
                                >
                                    {n}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            <div style={{ paddingTop: 24, paddingBottom: 16 }}>
                <button
                    onClick={onGenerate}
                    disabled={!canGenerate}
                    className="btn btn-primary btn-glow w-full"
                >
                    Generate Questions
                </button>
            </div>
        </div>
    );
}
