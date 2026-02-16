import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { QRCodeCanvas } from 'qrcode.react';
import { WS_URL } from '../config';
import { type PlayerInfo, type RoundResult, type LeaderboardEntry, type Superlative, type PodiumEntry } from '../types';
import AnimatedNumber from '../components/AnimatedNumber';
import Fireworks from '../components/Fireworks';
import { soundManager } from '../utils/sound';

type SpectatorState = 'CONNECTING' | 'ERROR' | 'DISCONNECTED' | 'LOBBY' | 'QUESTION' | 'REVEAL' | 'PODIUM';

const AVATAR_COLORS = [
    '#FF006E', '#FF6B6B', '#FF8C42', '#FFD93D', '#00E676',
    '#00BCD4', '#7C4DFF', '#E040FB', '#FF5252', '#64FFDA',
    '#FFAB40', '#B388FF', '#69F0AE', '#FF80AB', '#40C4FF',
];

export default function SpectatorPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const roomFromUrl = searchParams.get('room') || '';
    const [roomCode, setRoomCode] = useState(roomFromUrl);
    const [roomInput, setRoomInput] = useState('');
    const [joined, setJoined] = useState(!!roomFromUrl);
    const [gameState, setGameState] = useState<SpectatorState>(roomFromUrl ? 'CONNECTING' : 'LOBBY');
    const [players, setPlayers] = useState<PlayerInfo[]>([]);
    const [playerCount, setPlayerCount] = useState(0);

    // Question state
    const [promptText, setPromptText] = useState('');
    const [questionNumber, setQuestionNumber] = useState(0);
    const [totalQuestions, setTotalQuestions] = useState(0);
    const [timeRemaining, setTimeRemaining] = useState(0);
    const [timerSeconds, setTimerSeconds] = useState(30);
    const [votedCount, setVotedCount] = useState(0);

    // Round result
    const [roundResult, setRoundResult] = useState<RoundResult | null>(null);

    // Final results
    const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
    const [superlatives, setSuperlatives] = useState<Superlative[]>([]);
    const [podiumReveal, setPodiumReveal] = useState(0);

    const joinUrl = `http://${window.location.hostname}:5173/join?room=${roomCode}`;
    const displayUrl = `${window.location.hostname}:5173/join`;

    const handleJoinRoom = () => {
        const code = roomInput.trim().toUpperCase();
        if (code.length < 4) return;
        setRoomCode(code);
        setJoined(true);
        setGameState('CONNECTING');
        setSearchParams({ room: code });
    };

    useEffect(() => {
        if (!joined || !roomCode) return;
        const clientId = `spectator-${Date.now()}`;
        const ws = new WebSocket(`${WS_URL}/ws/${roomCode}/${clientId}?spectator=true`);

        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);

            if (msg.type === 'SPECTATOR_SYNC') {
                setGameState(msg.state === 'LOBBY' ? 'LOBBY' : msg.state);
                setPlayers(msg.players || []);
                setPlayerCount(msg.player_count);
                setQuestionNumber(msg.question_number || 0);
                setTotalQuestions(msg.total_questions || 0);
            }
            else if (msg.type === 'PLAYER_JOINED') {
                setPlayerCount(msg.player_count);
                setPlayers(msg.players || []);
                setGameState('LOBBY');
            }
            else if (msg.type === 'PLAYER_LEFT') {
                setPlayerCount(msg.player_count);
                setPlayers(msg.players || []);
            }
            else if (msg.type === 'GAME_STARTING') {
                // Game about to begin
            }
            else if (msg.type === 'QUESTION') {
                setPromptText(msg.prompt?.text || '');
                setQuestionNumber(msg.question_number);
                setTotalQuestions(msg.total_questions);
                setTimerSeconds(msg.timer_seconds);
                setTimeRemaining(msg.timer_seconds);
                setVotedCount(0);
                setRoundResult(null);
                setGameState('QUESTION');
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
                setGameState('REVEAL');
                soundManager.play('drumroll');
                setTimeout(() => soundManager.play('reveal'), 800);
            }
            else if (msg.type === 'PODIUM') {
                setLeaderboard(msg.leaderboard || []);
                setSuperlatives(msg.superlatives || []);
                setPodiumReveal(0);
                setGameState('PODIUM');
                soundManager.play('fanfare');
            }
            else if (msg.type === 'ROOM_RESET') {
                setPlayers(msg.players || []);
                setPlayerCount(msg.player_count);
                setRoundResult(null);
                setGameState('LOBBY');
            }
        };

        ws.onerror = () => setGameState('ERROR');
        ws.onclose = () => setGameState('DISCONNECTED');

        return () => ws.close();
    }, [joined, roomCode]);

    // Auto-fullscreen
    useEffect(() => {
        if (document.fullscreenElement) return;
        document.documentElement.requestFullscreen?.().catch(() => {});
    }, []);

    // Staggered podium reveal for final screen
    useEffect(() => {
        if (gameState !== 'PODIUM') return;
        setPodiumReveal(0);
        const timers = [
            setTimeout(() => setPodiumReveal(1), 300),
            setTimeout(() => setPodiumReveal(2), 1000),
            setTimeout(() => setPodiumReveal(3), 1700),
            setTimeout(() => setPodiumReveal(4), 2500),
        ];
        return () => timers.forEach(clearTimeout);
    }, [gameState]);

    useEffect(() => {
        if (podiumReveal >= 1 && podiumReveal <= 3) {
            soundManager.play('fireworkPop');
        }
    }, [podiumReveal]);

    if (!joined) {
        return (
            <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 60px' }}>
                <div className="animate-in" style={{ textAlign: 'center', maxWidth: 500, width: '100%' }}>
                    <div style={{ fontSize: '4rem', marginBottom: 16 }}>📺</div>
                    <h1 className="hero-title" style={{ fontSize: '3rem', marginBottom: 8 }}>TV Mode</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '1.25rem', marginBottom: 40 }}>
                        Enter the room code to spectate
                    </p>
                    <input
                        type="text"
                        value={roomInput}
                        onChange={(e) => setRoomInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
                        onKeyDown={(e) => e.key === 'Enter' && handleJoinRoom()}
                        placeholder="ROOM CODE"
                        autoFocus
                        style={{
                            width: '100%',
                            textAlign: 'center',
                            fontSize: '3rem',
                            fontWeight: 800,
                            letterSpacing: '0.3em',
                            padding: '20px 24px',
                            borderRadius: 16,
                            border: '2px solid rgba(255, 255, 255, 0.15)',
                            background: 'var(--color-card)',
                            color: 'var(--color-text)',
                            outline: 'none',
                            marginBottom: 24,
                        }}
                    />
                    <button
                        onClick={handleJoinRoom}
                        disabled={roomInput.trim().length < 4}
                        className="btn btn-primary btn-glow"
                        style={{ width: '100%', fontSize: '1.25rem', padding: '16px 24px' }}
                    >
                        Watch Game
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="app-container">
            <div className="content-wrapper">
                <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', justifyContent: 'center', maxWidth: '100%', padding: '40px 60px' }}>

                    {/* CONNECTING / ERROR / DISCONNECTED */}
                    {(gameState === 'CONNECTING' || gameState === 'ERROR' || gameState === 'DISCONNECTED') && (
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }} className="animate-in">
                            <div style={{ fontSize: '4rem', marginBottom: 16 }}>
                                {gameState === 'CONNECTING' ? '📡' : gameState === 'ERROR' ? '⚠️' : '🔌'}
                            </div>
                            <h1 className="hero-title" style={{ marginBottom: 8 }}>
                                {gameState === 'CONNECTING' ? 'Connecting...' : gameState === 'ERROR' ? 'Connection Error' : 'Disconnected'}
                            </h1>
                            <p style={{ color: 'var(--color-text-secondary)', fontSize: '1.125rem' }}>Room: {roomCode}</p>
                            {gameState === 'CONNECTING' && (
                                <div style={{ display: 'flex', gap: 6, marginTop: 24 }}>
                                    {[0, 1, 2].map((i) => (
                                        <div key={i} className="animate-bounce"
                                            style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--color-primary)', animationDelay: `${i * 0.15}s` }} />
                                    ))}
                                </div>
                            )}
                            {(gameState === 'ERROR' || gameState === 'DISCONNECTED') && (
                                <button
                                    onClick={() => { setJoined(false); setRoomInput(''); setSearchParams({}); }}
                                    className="btn btn-secondary"
                                    style={{ marginTop: 24, fontSize: '1.125rem' }}
                                >
                                    Try Another Room
                                </button>
                            )}
                        </div>
                    )}

                    {/* LOBBY */}
                    {gameState === 'LOBBY' && (
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }} className="animate-in">
                            <h1 className="hero-title" style={{ fontSize: '3.5rem', marginBottom: 32 }}>Who's Most Likely To</h1>

                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 48, marginBottom: 32 }}>
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                    <div className="qr-container" style={{ marginBottom: 8 }}>
                                        <QRCodeCanvas value={joinUrl} size={200} bgColor="white" fgColor="#000000" level="H" />
                                    </div>
                                    <p style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>Scan with your phone</p>
                                </div>

                                <div style={{ color: 'var(--color-text-secondary)', fontSize: '1.25rem', fontWeight: 500 }}>or</div>

                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                    <div className="room-code" style={{ fontSize: '4rem', marginBottom: 8 }}>{roomCode}</div>
                                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '1.125rem' }}>{displayUrl}</p>
                                </div>
                            </div>

                            <p style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 16 }}>
                                {playerCount} player{playerCount !== 1 ? 's' : ''}
                            </p>
                            {players.length > 0 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 12, maxWidth: 672 }}>
                                    {players.map((player, i) => (
                                        <div key={player.nickname} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: 9999, background: 'var(--color-card)' }}>
                                            <div style={{
                                                width: 40, height: 40, minWidth: 40, borderRadius: '50%',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                backgroundColor: AVATAR_COLORS[i % AVATAR_COLORS.length],
                                            }}>
                                                <span style={{ fontSize: '1.4rem', lineHeight: 1 }}>{player.avatar || player.nickname.slice(0, 2).toUpperCase()}</span>
                                            </div>
                                            <span style={{ fontSize: '1.125rem', fontWeight: 500 }}>{player.nickname}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* QUESTION */}
                    {gameState === 'QUESTION' && (
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                            <div style={{ padding: '16px 0' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                    <span style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--color-text-secondary)' }}>
                                        Round {questionNumber}/{totalQuestions}
                                    </span>
                                    <span style={{
                                        fontWeight: 800, fontVariantNumeric: 'tabular-nums', fontSize: '2rem',
                                        color: timeRemaining <= 5 ? 'var(--color-danger)' : timeRemaining <= 10 ? 'var(--color-warning)' : 'var(--color-primary)',
                                    }} className={timeRemaining <= 5 ? 'timer-number-pulse' : ''}>
                                        {timeRemaining}s
                                    </span>
                                </div>
                                <div className="question-timer-bar" style={{ height: 8 }}>
                                    <div
                                        className="question-timer-fill"
                                        style={{
                                            width: `${(timeRemaining / timerSeconds) * 100}%`,
                                            background: timeRemaining <= 5 ? 'var(--color-danger)' : timeRemaining <= 10 ? 'var(--color-warning)' : 'var(--color-primary)',
                                        }}
                                    />
                                </div>
                            </div>

                            <div className="card question-enter" style={{ padding: 48, marginBottom: 32, textAlign: 'center' }}>
                                <p style={{ fontSize: '2rem', fontWeight: 700, lineHeight: 1.4 }}>
                                    {promptText}
                                </p>
                            </div>

                            <p style={{ textAlign: 'center', fontSize: '1.25rem', color: 'var(--color-text-secondary)', marginBottom: 24 }}>
                                <span style={{ fontWeight: 700, color: 'var(--color-text)' }}>{votedCount}</span> of {playerCount} voted
                            </p>

                            {/* Player grid */}
                            {players.length > 0 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 12, maxWidth: 800, margin: '0 auto' }}>
                                    {players.map((player, i) => (
                                        <div key={player.nickname} style={{
                                            display: 'inline-flex', alignItems: 'center', gap: 10,
                                            padding: '10px 20px', borderRadius: 9999,
                                            background: 'var(--color-card)', border: '1px solid rgba(255, 255, 255, 0.08)',
                                        }}>
                                            <div style={{
                                                width: 36, height: 36, minWidth: 36, borderRadius: '50%',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                backgroundColor: AVATAR_COLORS[i % AVATAR_COLORS.length],
                                            }}>
                                                <span style={{ fontSize: '1.25rem', lineHeight: 1 }}>{player.avatar || player.nickname.slice(0, 2).toUpperCase()}</span>
                                            </div>
                                            <span style={{ fontSize: '1.125rem', fontWeight: 600 }}>{player.nickname}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* REVEAL — Round results */}
                    {gameState === 'REVEAL' && roundResult && (
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }} className="animate-in">
                            <div style={{ textAlign: 'center', marginBottom: 16 }}>
                                <p style={{ fontSize: 16, color: 'var(--color-text-secondary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
                                    Round {questionNumber} Results
                                </p>
                                <p style={{ fontSize: '1.25rem', color: 'var(--color-text-secondary)', marginTop: 4 }}>
                                    {roundResult.prompt.text}
                                </p>
                            </div>

                            {/* Podium */}
                            <div className="podium-container" style={{ gap: 16, padding: '40px 0', marginBottom: 24 }}>
                                {(() => {
                                    const top3 = roundResult.podium.slice(0, 3);
                                    const ordered: (PodiumEntry | null)[] = [
                                        top3[1] || null,
                                        top3[0] || null,
                                        top3[2] || null,
                                    ];
                                    return ordered.map((entry, displayIdx) => {
                                        if (!entry) return <div key={displayIdx} className="podium-slot" />;
                                        const rank = entry.rank;
                                        const heightMap: Record<number, number> = { 1: 160, 2: 120, 3: 90 };
                                        const height = heightMap[rank] || 60;
                                        return (
                                            <div key={entry.nickname} className={`podium-slot podium-${rank}`}>
                                                <div className="podium-avatar" style={{ animationDelay: `${(3 - rank) * 0.3}s` }}>
                                                    {rank === 1 && <span className="podium-crown" style={{ fontSize: '2rem' }}>👑</span>}
                                                    <span style={{ fontSize: '2.5rem' }}>{entry.avatar}</span>
                                                </div>
                                                <p style={{ fontWeight: 700, fontSize: 18, marginBottom: 4 }}>{entry.nickname}</p>
                                                <p style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>
                                                    {entry.vote_count} vote{entry.vote_count !== 1 ? 's' : ''}
                                                </p>
                                                <div className="podium-bar" style={{ height, width: 120, animationDelay: `${(3 - rank) * 0.3}s` }}>
                                                    <span className="podium-rank" style={{ fontSize: 24 }}>{rank}</span>
                                                </div>
                                            </div>
                                        );
                                    });
                                })()}
                            </div>

                            {/* Vote breakdown for spectators */}
                            {roundResult.votes.length > 0 && (
                                <div style={{ maxWidth: 600, width: '100%' }}>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                                        {roundResult.votes.map((v, i) => (
                                            <div key={i} className="vote-breakdown-row" style={{ animationDelay: `${i * 0.1}s`, fontSize: 16 }}>
                                                <span style={{ fontWeight: 500 }}>{v.voter}</span>
                                                <span style={{ color: 'var(--color-text-secondary)' }}>→</span>
                                                <span style={{ fontWeight: 700, color: 'var(--color-primary)' }}>{v.target}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* PODIUM — Final results */}
                    {gameState === 'PODIUM' && (
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }} className="animate-in">
                            <Fireworks duration={15000} maxRockets={4} />

                            <h1 className="hero-title" style={{ fontSize: '3rem', position: 'relative', zIndex: 11, marginBottom: 24 }}>
                                Final Results
                            </h1>

                            {podiumReveal >= 4 && leaderboard[0] && (
                                <div className="champion-label" style={{ position: 'relative', zIndex: 11, fontSize: 28 }}>
                                    <span className="crown-bounce" style={{ fontSize: 36 }}>👑</span>
                                    <span className="gold-shimmer">{leaderboard[0].nickname} wins!</span>
                                </div>
                            )}

                            <div className="podium-container" style={{ gap: 16, padding: '40px 0', position: 'relative', zIndex: 11 }}>
                                {leaderboard[1] && (
                                    <div className={`podium-place podium-2 ${podiumReveal >= 2 ? '' : 'podium-hidden'}`}>
                                        <span style={{ fontSize: '2.5rem', marginBottom: 8 }}>{leaderboard[1].avatar}</span>
                                        <p className="podium-name" style={{ fontSize: 18 }}>{leaderboard[1].nickname}</p>
                                        <div className="podium-bar" style={{ width: 120, height: 120 }}>2</div>
                                        <p className="podium-score" style={{ fontSize: 16 }}><AnimatedNumber value={podiumReveal >= 2 ? leaderboard[1].score : 0} /></p>
                                    </div>
                                )}
                                {leaderboard[0] && (
                                    <div className={`podium-place podium-1 ${podiumReveal >= 3 ? '' : 'podium-hidden'} ${podiumReveal >= 4 ? 'victory-glow' : ''}`}>
                                        {podiumReveal >= 4 && <span className="crown-bounce" style={{ fontSize: 40, marginBottom: 4 }}>👑</span>}
                                        <span style={{ fontSize: '3rem', marginBottom: 8 }}>{leaderboard[0].avatar}</span>
                                        <p className="podium-name" style={{ fontSize: 18 }}>{leaderboard[0].nickname}</p>
                                        <div className="podium-bar" style={{ width: 120, height: 160 }}>1</div>
                                        <p className="podium-score" style={{ fontSize: 16 }}><AnimatedNumber value={podiumReveal >= 3 ? leaderboard[0].score : 0} /></p>
                                    </div>
                                )}
                                {leaderboard[2] && (
                                    <div className={`podium-place podium-3 ${podiumReveal >= 1 ? '' : 'podium-hidden'}`}>
                                        <span style={{ fontSize: '2.5rem', marginBottom: 8 }}>{leaderboard[2].avatar}</span>
                                        <p className="podium-name" style={{ fontSize: 18 }}>{leaderboard[2].nickname}</p>
                                        <div className="podium-bar" style={{ width: 120, height: 80 }}>3</div>
                                        <p className="podium-score" style={{ fontSize: 16 }}><AnimatedNumber value={podiumReveal >= 1 ? leaderboard[2].score : 0} /></p>
                                    </div>
                                )}
                            </div>

                            {/* Superlatives on TV */}
                            {podiumReveal >= 4 && superlatives.length > 0 && (
                                <div style={{ maxWidth: 600, width: '100%', position: 'relative', zIndex: 11, marginTop: 24 }}>
                                    <p style={{ textAlign: 'center', fontWeight: 700, fontSize: 20, marginBottom: 16 }}>Awards</p>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
                                        {superlatives.map((s, i) => (
                                            <div key={i} className="superlative-card" style={{ animationDelay: `${i * 0.3}s`, minWidth: 250 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                                    <span style={{ fontSize: '2rem' }}>{s.avatar}</span>
                                                    <div>
                                                        <p style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-primary)' }}>{s.title}</p>
                                                        <p style={{ fontWeight: 600, fontSize: 18 }}>{s.winner}</p>
                                                        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{s.detail}</p>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
