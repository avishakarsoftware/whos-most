import { useState } from 'react';
import { type PromptPack, type Prompt } from '../../types';
import { useSwipeBack } from '../../utils/useSwipeBack';

interface ReviewScreenProps {
    pack: PromptPack;
    timerSeconds: number;
    setTimerSeconds: (v: number) => void;
    showVotes: boolean;
    setShowVotes: (v: boolean) => void;
    onCreateRoom: () => void;
    onUpdatePack: (pack: PromptPack) => void;
    onBack: () => void;
}

const TIME_PRESETS = [
    { value: 15, label: '15s' },
    { value: 30, label: '30s' },
    { value: 45, label: '45s' },
    { value: 60, label: '60s' },
];

export default function ReviewScreen({
    pack, timerSeconds, setTimerSeconds,
    showVotes, setShowVotes,
    onCreateRoom, onUpdatePack, onBack,
}: ReviewScreenProps) {
    const swipeProgress = useSwipeBack(onBack);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editText, setEditText] = useState('');
    const [addingNew, setAddingNew] = useState(false);
    const [newPromptText, setNewPromptText] = useState('');

    const startEdit = (p: Prompt) => {
        setEditingId(p.id);
        setEditText(p.text);
    };

    const cancelEdit = () => {
        setEditingId(null);
        setEditText('');
    };

    const saveEdit = () => {
        if (!editText.trim()) return;
        const updated: PromptPack = {
            ...pack,
            prompts: pack.prompts.map(p => p.id === editingId ? { ...p, text: editText.trim() } : p),
        };
        onUpdatePack(updated);
        setEditingId(null);
        setEditText('');
    };

    const deletePrompt = (id: number) => {
        if (pack.prompts.length <= 3) return;
        const updated: PromptPack = {
            ...pack,
            prompts: pack.prompts.filter(p => p.id !== id),
        };
        onUpdatePack(updated);
    };

    const addPrompt = () => {
        if (!newPromptText.trim()) return;
        const maxId = Math.max(0, ...pack.prompts.map(p => p.id));
        const updated: PromptPack = {
            ...pack,
            prompts: [...pack.prompts, { id: maxId + 1, text: newPromptText.trim() }],
        };
        onUpdatePack(updated);
        setNewPromptText('');
        setAddingNew(false);
    };

    return (
        <div className="min-h-dvh flex flex-col container-responsive safe-top safe-bottom animate-in">
            {/* Swipe-back indicator */}
            {swipeProgress > 0 && (
                <div className="swipe-back-indicator" style={{ opacity: swipeProgress, transform: `translateX(${swipeProgress * 24 - 24}px)` }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="15 18 9 12 15 6" />
                    </svg>
                </div>
            )}

            {/* Header */}
            <div className="review-header" style={{ marginBottom: 16 }}>
                <div className="review-header-accent" />
                <h1 className="hero-title" style={{ textAlign: 'center', marginBottom: 8 }}>{pack.title}</h1>
                <p style={{ textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: 14 }}>
                    {pack.prompts.length} prompts ready to go
                </p>
            </div>

            {/* Timer setting */}
            <div style={{ marginBottom: 16 }}>
                <p style={{ textAlign: 'center', fontWeight: 600, fontSize: 14, marginBottom: 8 }}>
                    <span style={{ fontSize: '1.5rem', verticalAlign: 'middle', marginRight: 6 }}>⏱</span>
                    Time per round
                </p>
                <div className="time-preset-selector">
                    {TIME_PRESETS.map((t) => (
                        <button
                            key={t.value}
                            onClick={() => setTimerSeconds(t.value)}
                            className={`time-preset-option ${timerSeconds === t.value ? 'active' : ''}`}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Show votes toggle */}
            <div className="settings-row" style={{ marginBottom: 16 }}>
                <div>
                    <p style={{ fontWeight: 500, fontSize: 14 }}>Show who voted for whom</p>
                    <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Reveal individual votes after each round</p>
                </div>
                <button
                    onClick={() => setShowVotes(!showVotes)}
                    className={`settings-toggle ${showVotes ? 'settings-toggle-on' : ''}`}
                >
                    <span className="settings-toggle-knob" />
                </button>
            </div>

            {/* Prompt list */}
            <div className="flex-1 overflow-y-auto no-scrollbar" style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
                {pack.prompts.map((p, i) => (
                    <div key={p.id} className="review-question-card">
                        <div style={{ padding: 16 }}>
                            {editingId === p.id ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                        <span className="review-q-number">{i + 1}</span>
                                    </div>
                                    <textarea
                                        value={editText}
                                        onChange={(e) => setEditText(e.target.value)}
                                        className="input-field"
                                        style={{ fontSize: 14, minHeight: 60 }}
                                    />
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <button onClick={cancelEdit} className="btn btn-secondary" style={{ flex: 1, height: 36, fontSize: 13 }}>Cancel</button>
                                        <button onClick={saveEdit} className="btn btn-primary" style={{ flex: 1, height: 36, fontSize: 13 }}>Save</button>
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <div className="review-card-actions">
                                        <button
                                            onClick={() => startEdit(p)}
                                            className="review-action-btn"
                                            title="Edit"
                                        >
                                            ✎
                                        </button>
                                        {pack.prompts.length > 3 && (
                                            <button
                                                onClick={() => deletePrompt(p.id)}
                                                className="review-action-btn review-action-delete"
                                                title="Delete"
                                            >
                                                ✕
                                            </button>
                                        )}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                        <span className="review-q-number">{i + 1}</span>
                                    </div>
                                    <p style={{ fontSize: 14, fontWeight: 500 }}>{p.text}</p>
                                </>
                            )}
                        </div>
                    </div>
                ))}

                {/* Add new prompt */}
                {addingNew ? (
                    <div className="review-question-card" style={{ padding: 16 }}>
                        <textarea
                            value={newPromptText}
                            onChange={(e) => setNewPromptText(e.target.value)}
                            placeholder="Who is most likely to..."
                            className="input-field"
                            style={{ fontSize: 14, minHeight: 60, marginBottom: 12 }}
                            autoFocus
                        />
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={() => { setAddingNew(false); setNewPromptText(''); }} className="btn btn-secondary" style={{ flex: 1, height: 36, fontSize: 13 }}>Cancel</button>
                            <button onClick={addPrompt} disabled={!newPromptText.trim()} className="btn btn-primary" style={{ flex: 1, height: 36, fontSize: 13 }}>Add</button>
                        </div>
                    </div>
                ) : (
                    <button
                        onClick={() => setAddingNew(true)}
                        className="btn btn-secondary w-full"
                        style={{ borderStyle: 'dashed', height: 44 }}
                    >
                        + Add Custom Prompt
                    </button>
                )}
            </div>

            {/* Bottom actions */}
            <div style={{ paddingBottom: 16, display: 'flex', gap: 8 }}>
                <button onClick={onBack} className="btn btn-secondary" style={{ flexShrink: 0, paddingLeft: 16, paddingRight: 16 }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="15 18 9 12 15 6" />
                    </svg>
                </button>
                <button onClick={onCreateRoom} className="btn btn-primary btn-glow" style={{ flex: 1 }}>Create Room</button>
            </div>
        </div>
    );
}
