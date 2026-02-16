import { useState, useRef, useEffect, useCallback } from 'react';
import { API_URL, WS_URL } from '../config';
import { type PromptPack, type PlayerInfo, type VibeId, type LeaderboardEntry, type Superlative, type RoundResult, type PodiumEntry } from '../types';
import { soundManager } from '../utils/sound';
import PromptScreen, { type AIProvider } from '../components/organizer/PromptScreen';
import LoadingScreen from '../components/organizer/LoadingScreen';
import ReviewScreen from '../components/organizer/ReviewScreen';
import LobbyScreen from '../components/organizer/LobbyScreen';

type OrganizerState = 'PROMPT' | 'LOADING' | 'REVIEW' | 'ROOM' | 'QUESTION' | 'REVEAL' | 'PODIUM';

export default function OrganizerPage() {
    // Flow state
    const [state, setState] = useState<OrganizerState>('PROMPT');

    // Prompt generation
    const [vibe, setVibe] = useState<VibeId>('party');
    const [customTheme, setCustomTheme] = useState('');
    const [numPrompts, setNumPrompts] = useState(10);
    const [provider, setProvider] = useState('ollama');
    const [providers, setProviders] = useState<AIProvider[]>([]);

    // Pack data
    const [pack, setPack] = useState<PromptPack | null>(null);
    const [packId, setPackId] = useState('');

    // Game settings
    const [timerSeconds, setTimerSeconds] = useState(30);
    const [showVotes, setShowVotes] = useState(true);

    // Room
    const [roomCode, setRoomCode] = useState('');
    const [networkIp, setNetworkIp] = useState(window.location.hostname);
    const [playerCount, setPlayerCount] = useState(0);
    const [players, setPlayers] = useState<PlayerInfo[]>([]);

    // Game state
    const [currentPromptText, setCurrentPromptText] = useState('');
    const [questionNumber, setQuestionNumber] = useState(0);
    const [totalQuestions, setTotalQuestions] = useState(0);
    const [timeRemaining, setTimeRemaining] = useState(60);
    const [votedCount, setVotedCount] = useState(0);

    // Round reveal
    const [roundResult, setRoundResult] = useState<RoundResult | null>(null);

    // Final results
    const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
    const [superlatives, setSuperlatives] = useState<Superlative[]>([]);
    const [roundHistory, setRoundHistory] = useState<RoundResult[]>([]);

    // Organizer voting
    const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
    const [hasVoted, setHasVoted] = useState(false);

    // Auto-advance
    const [autoAdvance, setAutoAdvance] = useState(true);
    const [autoCountdown, setAutoCountdown] = useState(0);
    const autoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Refs
    const wsRef = useRef<WebSocket | null>(null);
    const stateRef = useRef<OrganizerState>('PROMPT');
    const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const roomCodeRef = useRef('');
    const organizerTokenRef = useRef('');

    useEffect(() => { stateRef.current = state; }, [state]);
    useEffect(() => { roomCodeRef.current = roomCode; }, [roomCode]);

    // Fetch providers and network IP on mount
    useEffect(() => {
        fetch(`${API_URL}/providers`)
            .then(res => res.json())
            .then(data => {
                setProviders(data.providers || []);
                const defaultProvider = data.providers?.find((p: AIProvider) => p.available);
                if (defaultProvider) setProvider(defaultProvider.id);
            })
            .catch(() => {});

        fetch(`${API_URL}/system/info`)
            .then(res => res.json())
            .then(data => {
                if (data.ip && data.ip !== '127.0.0.1') {
                    setNetworkIp(data.ip);
                }
            })
            .catch(() => {});
    }, []);

    // WebSocket message handler
    const handleWsMessage = useCallback((event: MessageEvent) => {
        const msg = JSON.parse(event.data);

        if (msg.type === 'PLAYER_JOINED') {
            setPlayerCount(msg.player_count);
            setPlayers(msg.players || []);
            soundManager.play('playerJoin');
        }
        else if (msg.type === 'PLAYER_LEFT') {
            setPlayerCount(msg.player_count);
            setPlayers(msg.players || []);
        }
        else if (msg.type === 'GAME_STARTING') {
            // Game is about to begin
        }
        else if (msg.type === 'QUESTION') {
            setCurrentPromptText(msg.prompt?.text || '');
            setQuestionNumber(msg.question_number);
            setTotalQuestions(msg.total_questions);
            setTimeRemaining(msg.timer_seconds);
            setVotedCount(0);
            setSelectedTarget(null);
            setHasVoted(false);
            setRoundResult(null);
            setState('QUESTION');
        }
        else if (msg.type === 'TIMER') {
            setTimeRemaining(msg.remaining);
        }
        else if (msg.type === 'VOTE_COUNT') {
            setVotedCount(msg.voted);
        }
        else if (msg.type === 'ROUND_RESULT') {
            const result: RoundResult = {
                prompt: msg.prompt,
                votes: msg.votes || [],
                podium: msg.podium || [],
                majority_winner: msg.majority_winner || '',
                prediction_points: msg.prediction_points || {},
            };
            setRoundResult(result);
            setState('REVEAL');
            soundManager.play('reveal');
        }
        else if (msg.type === 'PODIUM') {
            setLeaderboard(msg.leaderboard || []);
            setSuperlatives(msg.superlatives || []);
            setRoundHistory(msg.round_history || []);
            setState('PODIUM');
            soundManager.play('fanfare');
        }
        else if (msg.type === 'ROOM_RESET') {
            setPlayerCount(msg.player_count);
            setPlayers(msg.players || []);
            setState('ROOM');
        }
        else if (msg.type === 'ORGANIZER_RECONNECTED') {
            setRoomCode(msg.room_code);
            setPlayerCount(msg.player_count);
            setPlayers(msg.players || []);
            setTotalQuestions(msg.total_questions || 0);
            setTimerSeconds(msg.timer_seconds || 60);

            if (msg.state === 'LOBBY') {
                setState('ROOM');
            } else if (msg.state === 'QUESTION') {
                setQuestionNumber(msg.question_number || 0);
                setTimeRemaining(msg.time_remaining ?? msg.timer_seconds);
                setVotedCount(msg.voted_count ?? 0);
                setCurrentPromptText(msg.prompt?.text || '');
                setState('QUESTION');
            } else if (msg.state === 'REVEAL') {
                setState('REVEAL');
            } else if (msg.state === 'PODIUM') {
                setLeaderboard(msg.leaderboard || []);
                setSuperlatives(msg.superlatives || []);
                setState('PODIUM');
                soundManager.play('fanfare');
            }
        }
        else if (msg.type === 'ERROR') {
            console.error('Organizer error:', msg.message);
            if (msg.message === 'Room not found' || msg.message === 'Invalid organizer token') {
                // Room expired or server restarted — stop reconnecting and go back to start
                roomCodeRef.current = '';
                setRoomCode('');
                setState('PROMPT');
            } else {
                alert(msg.message || 'An error occurred');
            }
        }
    }, []);

    // WebSocket connection
    const connectWs = useCallback((code: string) => {
        if (wsRef.current) {
            wsRef.current.onclose = null;
            wsRef.current.close();
        }
        const clientId = `organizer-${Date.now()}`;
        const token = encodeURIComponent(organizerTokenRef.current);
        const ws = new WebSocket(`${WS_URL}/ws/${code}/${clientId}?organizer=true&token=${token}`);
        wsRef.current = ws;
        ws.onmessage = handleWsMessage;
        ws.onclose = () => {
            wsRef.current = null;
            const activeStates: OrganizerState[] = ['ROOM', 'QUESTION', 'REVEAL', 'PODIUM'];
            if (roomCodeRef.current && activeStates.includes(stateRef.current)) {
                reconnectTimerRef.current = setTimeout(() => connectWs(roomCodeRef.current), 2000);
            }
        };
    }, [handleWsMessage]);

    useEffect(() => {
        return () => { if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current); };
    }, []);

    // --- Actions ---

    const generatePrompts = async () => {
        setState('LOADING');
        try {
            const res = await fetch(`${API_URL}/prompts/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    vibe,
                    num_prompts: numPrompts,
                    provider,
                    custom_theme: vibe === 'custom' ? customTheme : undefined,
                }),
            });
            if (res.status === 429) {
                alert('Too many requests. Please wait a minute before generating again.');
                setState('PROMPT');
                return;
            }
            const data = await res.json();
            if (data.pack) {
                setPack(data.pack);
                setPackId(data.pack_id);
                setTotalQuestions(data.pack.prompts.length);
                setState('REVIEW');
            } else {
                alert(data.detail || 'Failed to generate prompts');
                setState('PROMPT');
            }
        } catch {
            alert('Connection error — is the backend running?');
            setState('PROMPT');
        }
    };

    const updatePack = async (updated: PromptPack) => {
        setPack(updated);
        setTotalQuestions(updated.prompts.length);
        await fetch(`${API_URL}/prompts/${packId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updated),
        });
    };

    const createRoom = async () => {
        // Play Again path: reuse existing room
        if (roomCode && wsRef.current && wsRef.current.readyState === WebSocket.OPEN && pack) {
            wsRef.current.send(JSON.stringify({
                type: 'RESET_ROOM',
                pack_data: pack,
                timer_seconds: timerSeconds,
                show_votes: showVotes,
            }));
            return;
        }

        const res = await fetch(`${API_URL}/room/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                pack_id: packId,
                timer_seconds: timerSeconds,
                show_votes: showVotes,
            }),
        });
        const data = await res.json();
        setRoomCode(data.room_code);
        organizerTokenRef.current = data.organizer_token || '';
        setState('ROOM');
        connectWs(data.room_code);
    };

    const startGame = () => {
        soundManager.play('gameStart');
        wsRef.current?.send(JSON.stringify({ type: 'START_GAME' }));
        wsRef.current?.send(JSON.stringify({ type: 'NEXT_QUESTION' }));
    };

    const nextQuestion = () => {
        wsRef.current?.send(JSON.stringify({ type: 'NEXT_QUESTION' }));
    };

    const skipQuestion = () => {
        wsRef.current?.send(JSON.stringify({ type: 'SKIP_QUESTION' }));
    };

    const endGame = () => {
        wsRef.current?.send(JSON.stringify({ type: 'END_GAME' }));
    };

    const submitVote = (target: string) => {
        if (hasVoted) return;
        setSelectedTarget(target);
        setHasVoted(true);
        wsRef.current?.send(JSON.stringify({ type: 'VOTE', target_nickname: target }));
        soundManager.play('voteIn');
        soundManager.vibrate(50);
    };

    const playAgain = () => {
        setQuestionNumber(0);
        setLeaderboard([]);
        setSuperlatives([]);
        setRoundHistory([]);
        setRoundResult(null);
        setSelectedTarget(null);
        setHasVoted(false);
        setState('PROMPT');
    };

    // Auto-advance: countdown when in REVEAL + auto mode
    useEffect(() => {
        if (autoTimerRef.current) {
            clearInterval(autoTimerRef.current);
            autoTimerRef.current = null;
        }
        if (state !== 'REVEAL' || !autoAdvance) {
            setAutoCountdown(0);
            return;
        }
        setAutoCountdown(7);
        autoTimerRef.current = setInterval(() => {
            setAutoCountdown(prev => {
                if (prev <= 1) {
                    if (autoTimerRef.current) clearInterval(autoTimerRef.current);
                    autoTimerRef.current = null;
                    wsRef.current?.send(JSON.stringify({ type: 'NEXT_QUESTION' }));
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        return () => {
            if (autoTimerRef.current) {
                clearInterval(autoTimerRef.current);
                autoTimerRef.current = null;
            }
        };
    }, [state, autoAdvance]);

    const joinUrl = `http://${networkIp}:5173/join?room=${roomCode}`;

    return (
        <div className="app-container">
            <div className="content-wrapper">
                {state === 'PROMPT' && (
                    <PromptScreen
                        vibe={vibe}
                        setVibe={setVibe}
                        customTheme={customTheme}
                        setCustomTheme={setCustomTheme}
                        numPrompts={numPrompts}
                        setNumPrompts={setNumPrompts}
                        provider={provider}
                        setProvider={setProvider}
                        providers={providers}
                        onGenerate={generatePrompts}
                    />
                )}

                {state === 'LOADING' && <LoadingScreen />}

                {state === 'REVIEW' && pack && (
                    <ReviewScreen
                        pack={pack}
                        timerSeconds={timerSeconds}
                        setTimerSeconds={setTimerSeconds}
                        showVotes={showVotes}
                        setShowVotes={setShowVotes}
                        onCreateRoom={createRoom}
                        onUpdatePack={updatePack}
                        onBack={() => setState('PROMPT')}
                    />
                )}

                {state === 'ROOM' && (
                    <LobbyScreen
                        roomCode={roomCode}
                        joinUrl={joinUrl}
                        networkIp={networkIp}
                        playerCount={playerCount}
                        players={players}
                        onStartGame={startGame}
                    />
                )}

                {state === 'QUESTION' && (
                    <div className="min-h-dvh flex flex-col container-responsive safe-top safe-bottom animate-in">
                        {/* Question header */}
                        <div style={{ textAlign: 'center', paddingTop: 24, marginBottom: 8 }}>
                            <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
                                Round {questionNumber} of {totalQuestions}
                            </p>
                        </div>

                        {/* Timer */}
                        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
                            <div style={{
                                fontSize: '2rem', fontWeight: 700,
                                color: timeRemaining <= 5 ? 'var(--color-danger)' : timeRemaining <= 10 ? 'var(--color-warning)' : 'var(--color-primary)',
                            }}>
                                {timeRemaining}s
                            </div>
                        </div>

                        {/* Prompt */}
                        <div className="card" style={{ padding: 24, marginBottom: 16, textAlign: 'center' }}>
                            <p style={{ fontSize: '1.25rem', fontWeight: 700, lineHeight: 1.4 }}>
                                {currentPromptText}
                            </p>
                        </div>

                        {/* Vote progress */}
                        <p style={{ textAlign: 'center', fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 16 }}>
                            <span style={{ fontWeight: 700, color: 'var(--color-text)' }}>{votedCount}</span> of {playerCount} voted
                        </p>

                        {/* Player list */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginBottom: 16 }}>
                            {players.map((player) => (
                                <span key={player.nickname} className="player-chip">
                                    <span>{player.avatar}</span>
                                    {player.nickname}
                                </span>
                            ))}
                        </div>

                        {/* Organizer controls */}
                        <div style={{ marginTop: 'auto', paddingBottom: 16, display: 'flex', gap: 8 }}>
                            <button onClick={skipQuestion} className="btn btn-secondary" style={{ flex: 1 }}>Skip</button>
                            <button onClick={endGame} className="btn btn-secondary" style={{ flex: 1 }}>End Game</button>
                        </div>
                    </div>
                )}

                {state === 'REVEAL' && roundResult && (
                    <div className="min-h-dvh flex flex-col container-responsive safe-top safe-bottom animate-in">
                        <div style={{ textAlign: 'center', paddingTop: 24, marginBottom: 8 }}>
                            <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
                                Round {questionNumber} Results
                            </p>
                            <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginTop: 4 }}>
                                {roundResult.prompt.text}
                            </p>
                        </div>

                        {/* Podium */}
                        <div className="podium-container" style={{ marginBottom: 24 }}>
                            {(() => {
                                const top3 = roundResult.podium.slice(0, 3);
                                // Display order: 2nd, 1st, 3rd
                                const ordered: (PodiumEntry | null)[] = [
                                    top3[1] || null,
                                    top3[0] || null,
                                    top3[2] || null,
                                ];
                                return ordered.map((entry, displayIdx) => {
                                    if (!entry) return <div key={displayIdx} className="podium-slot" />;
                                    const rank = entry.rank;
                                    const heightMap: Record<number, number> = { 1: 140, 2: 110, 3: 80 };
                                    const height = heightMap[rank] || 60;
                                    return (
                                        <div key={entry.nickname} className={`podium-slot podium-${rank}`}>
                                            <div className="podium-avatar" style={{ animationDelay: `${(3 - rank) * 0.3}s` }}>
                                                {rank === 1 && <span className="podium-crown">👑</span>}
                                                <span style={{ fontSize: '2rem' }}>{entry.avatar}</span>
                                            </div>
                                            <p style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{entry.nickname}</p>
                                            <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                                                {entry.vote_count} vote{entry.vote_count !== 1 ? 's' : ''}
                                            </p>
                                            <div className="podium-bar" style={{ height, animationDelay: `${(3 - rank) * 0.3}s` }}>
                                                <span className="podium-rank">{rank}</span>
                                            </div>
                                        </div>
                                    );
                                });
                            })()}
                        </div>

                        {/* Vote breakdown (if enabled) */}
                        {showVotes && roundResult.votes.length > 0 && (
                            <div className="card" style={{ padding: 16, marginBottom: 16 }}>
                                <p style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Vote Breakdown</p>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    {roundResult.votes.map((v, i) => (
                                        <div key={i} className="vote-breakdown-row" style={{ animationDelay: `${i * 0.1}s` }}>
                                            <span style={{ fontWeight: 500 }}>{v.voter}</span>
                                            <span style={{ color: 'var(--color-text-secondary)' }}>voted for</span>
                                            <span style={{ fontWeight: 700, color: 'var(--color-primary)' }}>{v.target}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Prediction points earned */}
                        {roundResult.prediction_points && Object.keys(roundResult.prediction_points).length > 0 && (
                            <div className="card" style={{ padding: 16, marginBottom: 16 }}>
                                <p style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Prediction Points</p>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                                    {Object.entries(roundResult.prediction_points).map(([name, pts]) => (
                                        <span key={name} className="score-pop" style={{
                                            padding: '4px 12px', borderRadius: 999, fontSize: 13, fontWeight: 600,
                                            background: pts > 0 ? 'rgba(0, 230, 118, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                                            color: pts > 0 ? 'var(--color-success)' : 'var(--color-text-secondary)',
                                        }}>
                                            {name}: +{pts}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Controls */}
                        <div style={{ marginTop: 'auto', paddingBottom: 16, display: 'flex', gap: 8 }}>
                            <button onClick={endGame} className="btn btn-secondary" style={{ flexShrink: 0, paddingLeft: 16, paddingRight: 16 }}>
                                End
                            </button>
                            {autoAdvance ? (
                                <div style={{ flex: 1, display: 'flex', gap: 8 }}>
                                    <button
                                        onClick={() => {
                                            if (autoTimerRef.current) { clearInterval(autoTimerRef.current); autoTimerRef.current = null; }
                                            wsRef.current?.send(JSON.stringify({ type: 'NEXT_QUESTION' }));
                                        }}
                                        className="btn btn-primary btn-glow"
                                        style={{ flex: 1 }}
                                    >
                                        Next {autoCountdown > 0 ? `(${autoCountdown}s)` : ''}
                                    </button>
                                    <button
                                        onClick={() => setAutoAdvance(false)}
                                        className="btn btn-secondary"
                                        style={{ flexShrink: 0, paddingLeft: 12, paddingRight: 12, fontSize: 13 }}
                                    >
                                        Manual
                                    </button>
                                </div>
                            ) : (
                                <div style={{ flex: 1, display: 'flex', gap: 8 }}>
                                    <button onClick={nextQuestion} className="btn btn-primary btn-glow" style={{ flex: 1 }}>
                                        Next Question
                                    </button>
                                    <button
                                        onClick={() => setAutoAdvance(true)}
                                        className="btn btn-secondary"
                                        style={{ flexShrink: 0, paddingLeft: 12, paddingRight: 12, fontSize: 13 }}
                                    >
                                        Auto
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {state === 'PODIUM' && (
                    <div className="min-h-dvh flex flex-col container-responsive safe-top safe-bottom animate-in">
                        <div style={{ textAlign: 'center', paddingTop: 24, marginBottom: 24 }}>
                            <div style={{ fontSize: '3rem', marginBottom: 8 }}>🏆</div>
                            <h1 className="hero-title">Game Over!</h1>
                            <p style={{ color: 'var(--color-text-secondary)', marginTop: 4 }}>Prediction Leaderboard</p>
                        </div>

                        {/* Leaderboard */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
                            {leaderboard.map((entry, i) => (
                                <div key={entry.nickname} className="leaderboard-row" style={{ animationDelay: `${i * 0.1}s` }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                        <span style={{ fontWeight: 800, fontSize: 18, width: 28, textAlign: 'center', color: i === 0 ? '#FFD700' : i === 1 ? '#C0C0C0' : i === 2 ? '#CD7F32' : 'var(--color-text-secondary)' }}>
                                            {entry.rank}
                                        </span>
                                        <span style={{ fontSize: '1.5rem' }}>{entry.avatar}</span>
                                        <span style={{ fontWeight: 600 }}>{entry.nickname}</span>
                                    </div>
                                    <span style={{ fontWeight: 700, color: 'var(--color-primary)' }}>{entry.score}</span>
                                </div>
                            ))}
                        </div>

                        {/* Superlatives */}
                        {superlatives.length > 0 && (
                            <div style={{ marginBottom: 24 }}>
                                <p style={{ textAlign: 'center', fontWeight: 700, fontSize: 16, marginBottom: 12 }}>Awards</p>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                    {superlatives.map((s, i) => (
                                        <div key={i} className="superlative-card" style={{ animationDelay: `${i * 0.2}s` }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                                <span style={{ fontSize: '2rem' }}>{s.avatar}</span>
                                                <div>
                                                    <p style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-primary)' }}>{s.title}</p>
                                                    <p style={{ fontWeight: 600, fontSize: 16 }}>{s.winner}</p>
                                                    <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{s.detail}</p>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Actions */}
                        <div style={{ marginTop: 'auto', paddingBottom: 16, display: 'flex', gap: 8 }}>
                            <button onClick={playAgain} className="btn btn-primary btn-glow" style={{ flex: 1 }}>
                                Play Again
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
