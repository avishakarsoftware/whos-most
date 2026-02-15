import { useState, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { WS_URL } from '../config';
import { type PlayerInfo, type RoundResult, type LeaderboardEntry, type Superlative, type PodiumEntry, AVATAR_EMOJIS } from '../types';
import { soundManager } from '../utils/sound';
import Fireworks from '../components/Fireworks';
import SettingsDrawer from '../components/SettingsDrawer';

type PlayerState = 'JOIN' | 'LOBBY' | 'QUESTION' | 'VOTED' | 'REVEAL' | 'PODIUM' | 'RECONNECTING';

const AVATAR_COLORS = [
    '#FF006E', '#FF6B6B', '#FF8C42', '#FFD93D', '#00E676',
    '#00BCD4', '#7C4DFF', '#E040FB', '#FF5252', '#64FFDA',
    '#FFAB40', '#B388FF', '#69F0AE', '#FF80AB', '#40C4FF',
];

function getSavedSession() {
    try {
        const raw = sessionStorage.getItem('whosmost_session');
        if (raw) return JSON.parse(raw) as { roomCode: string; nickname: string; avatar: string };
    } catch { /* ignore */ }
    return null;
}

export default function PlayerPage() {
    const [searchParams] = useSearchParams();
    const saved = getSavedSession();

    const [state, setState] = useState<PlayerState>('JOIN');
    const [roomCode, setRoomCode] = useState(searchParams.get('room') || saved?.roomCode || '');
    const [nickname, setNickname] = useState(saved?.nickname || '');
    const [avatar, setAvatar] = useState(() => saved?.avatar || AVATAR_EMOJIS[Math.floor(Math.random() * AVATAR_EMOJIS.length)]);
    const [error, setError] = useState('');

    // Lobby
    const [lobbyPlayers, setLobbyPlayers] = useState<PlayerInfo[]>([]);

    // Question / voting
    const [currentPromptText, setCurrentPromptText] = useState('');
    const [questionNumber, setQuestionNumber] = useState(0);
    const [totalQuestions, setTotalQuestions] = useState(0);
    const [timerSeconds, setTimerSeconds] = useState(30);
    const [timeRemaining, setTimeRemaining] = useState(60);
    const [players, setPlayers] = useState<PlayerInfo[]>([]);
    const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
    const [hasVoted, setHasVoted] = useState(false);

    // Reveal
    const [roundResult, setRoundResult] = useState<RoundResult | null>(null);
    const [myPredictionPoints, setMyPredictionPoints] = useState(0);

    // Final
    const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
    const [superlatives, setSuperlatives] = useState<Superlative[]>([]);

    const wsRef = useRef<WebSocket | null>(null);
    const autoJoinedRef = useRef(false);
    const kickedRef = useRef(false);

    // Auto-rejoin on refresh
    useEffect(() => {
        if (saved && !autoJoinedRef.current && !wsRef.current) {
            autoJoinedRef.current = true;
            const timer = setTimeout(() => joinRoom(), 100);
            return () => clearTimeout(timer);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const joinRoom = () => {
        if (!roomCode.trim() || !nickname.trim()) return;
        setError('');
        kickedRef.current = false;

        const clientId = `player-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const ws = new WebSocket(`${WS_URL}/ws/${roomCode}/${clientId}`);
        wsRef.current = ws;

        ws.onopen = () => ws.send(JSON.stringify({ type: 'JOIN', nickname, avatar }));

        ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);

            if (msg.type === 'ERROR') {
                if (msg.message === 'Room not found') {
                    sessionStorage.removeItem('whosmost_session');
                    setState('JOIN');
                }
                setError(msg.message);
                return;
            }
            if (msg.type === 'KICKED') {
                kickedRef.current = true;
                wsRef.current = null;
                setState('JOIN');
                setError('You joined from another device');
                return;
            }
            if (msg.type === 'JOINED_ROOM') {
                sessionStorage.setItem('whosmost_session', JSON.stringify({ roomCode, nickname, avatar }));
                setState('LOBBY');
            }
            if (msg.type === 'RECONNECTED') {
                sessionStorage.setItem('whosmost_session', JSON.stringify({ roomCode, nickname, avatar }));
                setQuestionNumber(msg.question_number || 0);
                setTotalQuestions(msg.total_questions || 0);
                if (msg.players) setPlayers(msg.players);
                if (msg.state === 'LOBBY') {
                    setState('LOBBY');
                } else if (msg.state === 'QUESTION') {
                    setCurrentPromptText(msg.prompt?.text || '');
                    setTimerSeconds(msg.timer_seconds || 60);
                    setTimeRemaining(msg.time_remaining ?? msg.timer_seconds);
                    setSelectedTarget(null);
                    setHasVoted(false);
                    setState('QUESTION');
                } else {
                    setState('VOTED');
                }
                return;
            }
            if (msg.type === 'PLAYER_JOINED') {
                if (msg.players) {
                    setLobbyPlayers(msg.players);
                    setPlayers(msg.players);
                }
                soundManager.play('playerJoin');
            }
            if (msg.type === 'PLAYER_LEFT') {
                if (msg.players) {
                    setLobbyPlayers(msg.players);
                    setPlayers(msg.players);
                }
            }
            if (msg.type === 'GAME_STARTING') {
                // Game about to begin
            }
            if (msg.type === 'QUESTION') {
                setCurrentPromptText(msg.prompt?.text || '');
                setQuestionNumber(msg.question_number);
                setTotalQuestions(msg.total_questions);
                setTimerSeconds(msg.timer_seconds);
                setTimeRemaining(msg.timer_seconds);
                if (msg.players) setPlayers(msg.players);
                setSelectedTarget(null);
                setHasVoted(false);
                setRoundResult(null);
                setState('QUESTION');
            }
            if (msg.type === 'TIMER') {
                setTimeRemaining(msg.remaining);
                if (msg.remaining <= 5 && msg.remaining > 0) soundManager.play('timerTick');
            }
            if (msg.type === 'VOTE_COUNT') {
                // Optional: show vote progress
            }
            if (msg.type === 'ROUND_RESULT') {
                const result: RoundResult = {
                    prompt: msg.prompt,
                    votes: msg.votes || [],
                    podium: msg.podium || [],
                    majority_winner: msg.majority_winner || '',
                    prediction_points: msg.prediction_points || {},
                };
                setRoundResult(result);
                setMyPredictionPoints(result.prediction_points[nickname] || 0);
                setState('REVEAL');
                soundManager.play('reveal');
                if (result.prediction_points[nickname] > 0) {
                    soundManager.vibrate(100);
                }
            }
            if (msg.type === 'PODIUM') {
                setLeaderboard(msg.leaderboard || []);
                setSuperlatives(msg.superlatives || []);
                setState('PODIUM');
                soundManager.play('fanfare');
            }
            if (msg.type === 'ROOM_RESET') {
                setQuestionNumber(0);
                setTotalQuestions(0);
                setSelectedTarget(null);
                setHasVoted(false);
                setRoundResult(null);
                setLeaderboard([]);
                setSuperlatives([]);
                setMyPredictionPoints(0);
                if (msg.players) {
                    setLobbyPlayers(msg.players);
                    setPlayers(msg.players);
                }
                setState('LOBBY');
                soundManager.play('playerJoin');
            }
        };

        ws.onerror = () => setError('Connection failed');
        ws.onclose = () => {
            if (kickedRef.current) { kickedRef.current = false; return; }
            setState((current) => {
                if (current !== 'JOIN' && current !== 'PODIUM') {
                    setTimeout(() => joinRoom(), 2000);
                    return 'RECONNECTING';
                }
                if (current === 'JOIN') setError('Room not found');
                return current;
            });
        };
    };

    const submitVote = (target: string) => {
        if (hasVoted) return;
        setSelectedTarget(target);
        setHasVoted(true);
        wsRef.current?.send(JSON.stringify({ type: 'VOTE', target_nickname: target }));
        soundManager.play('voteIn');
        soundManager.vibrate(50);
        setState('VOTED');
    };

    return (
        <div className="app-container">
            <div className="content-wrapper">

                {/* JOIN */}
                {state === 'JOIN' && (
                    <div className="container-responsive safe-bottom animate-in" style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                        <div style={{ position: 'absolute', top: 16, right: 16 }}>
                            <SettingsDrawer />
                        </div>
                        <div className="hero-icon" style={{ marginBottom: 16 }}>🎉</div>
                        <h1 className="hero-title" style={{ marginBottom: 8 }}>Join Game</h1>
                        <p style={{ color: 'var(--color-text-secondary)', marginBottom: 32 }}>Enter the game PIN to play</p>

                        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
                            <div className="stagger-in" style={{ animationDelay: '0.05s' }}>
                                <input
                                    type="text"
                                    value={roomCode}
                                    onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                                    placeholder="Game PIN"
                                    className="input-field"
                                    style={{ textAlign: 'center', fontSize: '1.5rem', letterSpacing: '0.2em', textTransform: 'uppercase' }}
                                    maxLength={6}
                                />
                            </div>

                            <div className="stagger-in" style={{ animationDelay: '0.1s' }}>
                                <input
                                    type="text"
                                    value={nickname}
                                    onChange={(e) => setNickname(e.target.value)}
                                    placeholder="Your nickname"
                                    className="input-field"
                                    style={{ textAlign: 'center' }}
                                    maxLength={20}
                                />
                            </div>

                            <div className="stagger-in" style={{ animationDelay: '0.15s' }}>
                                <p style={{ color: 'var(--color-text-secondary)', fontSize: 14, fontWeight: 500, textAlign: 'center', marginBottom: 8 }}>Choose your avatar</p>
                                <div
                                    style={{
                                        display: 'flex', gap: 8, overflowX: 'auto', padding: '8px 4px',
                                        scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch',
                                    }}
                                    className="no-scrollbar"
                                >
                                    {AVATAR_EMOJIS.map((emoji) => (
                                        <button
                                            key={emoji}
                                            type="button"
                                            onClick={() => setAvatar(emoji)}
                                            style={{
                                                flex: '0 0 auto', width: 48, height: 48, padding: 0,
                                                borderRadius: 12, border: 'none', cursor: 'pointer',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                fontSize: '2rem', scrollSnapAlign: 'start',
                                                transition: 'transform 0.15s, box-shadow 0.15s',
                                                backgroundColor: avatar === emoji ? 'var(--color-primary)' : 'var(--color-card)',
                                                transform: avatar === emoji ? 'scale(1.15)' : 'scale(1)',
                                                boxShadow: avatar === emoji ? '0 0 0 2px var(--color-primary), 0 4px 12px rgba(0,0,0,0.2)' : 'none',
                                            }}
                                        >
                                            {emoji}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {error && (
                                <div className="status-pill status-error" style={{ width: '100%', justifyContent: 'center' }}>{error}</div>
                            )}

                            <div className="stagger-in" style={{ animationDelay: '0.2s' }}>
                                <button
                                    onClick={joinRoom}
                                    disabled={!roomCode.trim() || !nickname.trim()}
                                    className="btn btn-primary btn-glow w-full"
                                >
                                    Join
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* LOBBY */}
                {state === 'LOBBY' && (
                    <div className="container-responsive animate-in" style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                        <div className="screen-hero">
                            <div className="hero-icon" style={{ marginBottom: 16 }}>👋</div>
                            <h1 className="hero-title">You're in!</h1>
                            <p className="hero-subtitle">Waiting for host to start</p>
                        </div>

                        {lobbyPlayers.length > 0 ? (
                            <div style={{ width: '100%', marginBottom: 24 }}>
                                <p style={{ textAlign: 'center', marginBottom: 12 }}>
                                    <span style={{ fontSize: '1.5rem', fontWeight: 700 }}>{lobbyPlayers.length}</span>{' '}
                                    <span style={{ color: 'var(--color-text-secondary)', fontWeight: 500 }}>player{lobbyPlayers.length !== 1 ? 's' : ''}</span>
                                </p>
                                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}>
                                    {lobbyPlayers.map((player, i) => {
                                        const isSelf = player.nickname === nickname;
                                        return (
                                            <div key={player.nickname} style={{
                                                display: 'inline-flex', alignItems: 'center', gap: 8,
                                                padding: '8px 16px', borderRadius: 9999,
                                                background: isSelf ? 'rgba(255, 0, 110, 0.15)' : 'var(--color-card)',
                                                boxShadow: isSelf ? 'inset 0 0 0 1px var(--color-primary)' : 'none',
                                            }}>
                                                <div style={{
                                                    width: 36, height: 36, minWidth: 36, borderRadius: '50%',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    backgroundColor: AVATAR_COLORS[i % AVATAR_COLORS.length],
                                                }}>
                                                    <span style={{ fontSize: '1.25rem', lineHeight: 1 }}>{player.avatar || player.nickname.slice(0, 2).toUpperCase()}</span>
                                                </div>
                                                <span style={{ fontSize: '1rem', fontWeight: isSelf ? 700 : 500, color: isSelf ? 'var(--color-primary)' : undefined }}>
                                                    {player.nickname}{isSelf ? ' ★' : ''}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ) : (
                            <div className="card" style={{ padding: '16px 32px', marginBottom: 24 }}>
                                <p style={{ fontSize: '1.125rem', fontWeight: 600 }}>{nickname}</p>
                            </div>
                        )}

                        <div style={{ display: 'flex', gap: 6, marginTop: 16 }}>
                            {[0, 1, 2].map((i) => (
                                <div key={i} className="animate-bounce"
                                    style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-primary)', animationDelay: `${i * 0.15}s` }} />
                            ))}
                        </div>
                    </div>
                )}

                {/* QUESTION — Voting */}
                {state === 'QUESTION' && (
                    <div className="min-h-dvh flex flex-col container-responsive safe-top safe-bottom">
                        <div style={{ padding: '16px 0' }} className="stagger-in">
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                <span style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>
                                    Round {questionNumber}/{totalQuestions}
                                </span>
                                <span style={{
                                    fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                                    color: timeRemaining <= 5 ? 'var(--color-danger)' : timeRemaining <= 10 ? 'var(--color-warning)' : 'var(--color-primary)',
                                }} className={timeRemaining <= 5 ? 'timer-number-pulse' : ''}>
                                    {timeRemaining}s
                                </span>
                            </div>
                            <div className="question-timer-bar">
                                <div
                                    className="question-timer-fill"
                                    style={{
                                        width: `${(timeRemaining / timerSeconds) * 100}%`,
                                        background: timeRemaining <= 5 ? 'var(--color-danger)' : timeRemaining <= 10 ? 'var(--color-warning)' : 'var(--color-primary)',
                                    }}
                                />
                            </div>
                        </div>

                        <div className="card question-enter" style={{ padding: 20, marginBottom: 16, textAlign: 'center' }}>
                            <p style={{ fontSize: '1.125rem', fontWeight: 700, lineHeight: 1.4 }}>
                                {currentPromptText}
                            </p>
                        </div>

                        <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 12 }}>
                            Tap someone to vote
                        </p>

                        <div className="vote-grid" style={{ flex: 1 }}>
                            {players.map((player, i) => (
                                <button
                                    key={player.nickname}
                                    onClick={() => submitVote(player.nickname)}
                                    className={`vote-card ${selectedTarget === player.nickname ? 'selected' : ''}`}
                                    style={{ animationDelay: `${0.1 + i * 0.05}s` }}
                                >
                                    <span style={{ fontSize: '2.5rem' }}>{player.avatar}</span>
                                    <span style={{ fontWeight: 700, fontSize: 16 }}>{player.nickname}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* VOTED — Waiting for others */}
                {state === 'VOTED' && (
                    <div className="min-h-dvh flex flex-col items-center justify-center container-responsive animate-in">
                        <div style={{ fontSize: '3rem', marginBottom: 16 }}>✓</div>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 8 }}>Vote Submitted!</h2>
                        <p style={{ color: 'var(--color-text-secondary)', marginBottom: 8 }}>
                            You voted for <span style={{ fontWeight: 700, color: 'var(--color-primary)' }}>{selectedTarget}</span>
                        </p>
                        <p style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>Waiting for others...</p>
                        <div style={{ display: 'flex', gap: 6, marginTop: 24 }}>
                            {[0, 1, 2].map((i) => (
                                <div key={i} className="animate-bounce"
                                    style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-primary)', animationDelay: `${i * 0.15}s` }} />
                            ))}
                        </div>
                    </div>
                )}

                {/* REVEAL — Round results */}
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

                        {/* Your prediction result */}
                        <div className="card" style={{ padding: 16, marginBottom: 16, textAlign: 'center' }}>
                            {myPredictionPoints > 0 ? (
                                <>
                                    <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4 }}>You predicted correctly!</p>
                                    <p className="score-pop" style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-success)' }}>+{myPredictionPoints}</p>
                                </>
                            ) : (
                                <>
                                    <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 4 }}>Better luck next question</p>
                                    <p style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-text-secondary)' }}>+0</p>
                                </>
                            )}
                        </div>

                        {/* Vote breakdown */}
                        {roundResult.votes.length > 0 && (
                            <div className="card" style={{ padding: 16, marginBottom: 16 }}>
                                <p style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>Vote Breakdown</p>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    {roundResult.votes.map((v, i) => (
                                        <div key={i} className="vote-breakdown-row" style={{ animationDelay: `${i * 0.1}s` }}>
                                            <span style={{ fontWeight: v.voter === nickname ? 700 : 500, color: v.voter === nickname ? 'var(--color-primary)' : undefined }}>
                                                {v.voter === nickname ? 'You' : v.voter}
                                            </span>
                                            <span style={{ color: 'var(--color-text-secondary)' }}>→</span>
                                            <span style={{ fontWeight: 700, color: 'var(--color-primary)' }}>{v.target}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <p style={{ textAlign: 'center', color: 'var(--color-text-secondary)', fontSize: 14, marginTop: 'auto', paddingBottom: 24 }}>
                            Waiting for next question...
                        </p>
                    </div>
                )}

                {/* PODIUM — Final results */}
                {state === 'PODIUM' && (
                    <div className="min-h-dvh flex flex-col items-center justify-center container-responsive safe-bottom animate-in"
                        style={{ position: 'relative', overflow: 'hidden' }}>
                        <Fireworks duration={10000} maxRockets={2} />

                        <div style={{ textAlign: 'center', marginBottom: 24, position: 'relative', zIndex: 11 }}>
                            <div style={{ fontSize: '3rem', marginBottom: 8 }}>🏆</div>
                            <h1 className="hero-title">Game Over!</h1>
                        </div>

                        {/* Player's rank */}
                        {(() => {
                            const myRank = leaderboard.findIndex(e => e.nickname === nickname) + 1;
                            if (myRank > 0) {
                                return (
                                    <div className="card" style={{ padding: '16px 32px', marginBottom: 24, textAlign: 'center', position: 'relative', zIndex: 11 }}>
                                        <p style={{ color: 'var(--color-text-secondary)', fontSize: 14, marginBottom: 4 }}>You finished</p>
                                        <p style={{ fontSize: '2.5rem', fontWeight: 800 }}>#{myRank}</p>
                                        <p style={{ color: 'var(--color-primary)', fontWeight: 700, fontSize: 18, marginTop: 4 }}>
                                            {leaderboard[myRank - 1]?.score || 0} pts
                                        </p>
                                    </div>
                                );
                            }
                            return null;
                        })()}

                        {/* Leaderboard */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24, width: '100%', position: 'relative', zIndex: 11 }}>
                            {leaderboard.slice(0, 5).map((entry, i) => {
                                const isMe = entry.nickname === nickname;
                                return (
                                    <div key={entry.nickname} className="leaderboard-row" style={{
                                        animationDelay: `${i * 0.1}s`,
                                        background: isMe ? 'rgba(255, 0, 110, 0.12)' : undefined,
                                        boxShadow: isMe ? 'inset 0 0 0 1px var(--color-primary)' : undefined,
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                            <span style={{
                                                fontWeight: 800, fontSize: 18, width: 28, textAlign: 'center',
                                                color: i === 0 ? '#FFD700' : i === 1 ? '#C0C0C0' : i === 2 ? '#CD7F32' : 'var(--color-text-secondary)',
                                            }}>
                                                {entry.rank}
                                            </span>
                                            <span style={{ fontSize: '1.5rem' }}>{entry.avatar}</span>
                                            <span style={{ fontWeight: isMe ? 700 : 600 }}>{entry.nickname}{isMe ? ' ★' : ''}</span>
                                        </div>
                                        <span style={{ fontWeight: 700, color: 'var(--color-primary)' }}>{entry.score}</span>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Superlatives */}
                        {superlatives.length > 0 && (
                            <div style={{ marginBottom: 24, width: '100%', position: 'relative', zIndex: 11 }}>
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

                        <p style={{ color: 'var(--color-text-secondary)', marginTop: 16, textAlign: 'center', position: 'relative', zIndex: 11 }}>
                            Waiting for host to start a new game...
                        </p>
                        <div style={{ display: 'flex', gap: 6, marginTop: 16, position: 'relative', zIndex: 11 }}>
                            {[0, 1, 2].map((i) => (
                                <div key={i} className="animate-bounce"
                                    style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-primary)', animationDelay: `${i * 0.15}s` }} />
                            ))}
                        </div>
                    </div>
                )}

                {/* RECONNECTING */}
                {state === 'RECONNECTING' && (
                    <div className="min-h-dvh flex flex-col items-center justify-center container-responsive animate-in">
                        <div style={{ fontSize: '3rem' }} className="animate-pulse">↻</div>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: 8, marginTop: 16 }}>Reconnecting...</h2>
                        <p style={{ color: 'var(--color-text-secondary)' }}>Don't worry, your score is saved</p>
                        <div style={{ display: 'flex', gap: 6, marginTop: 24 }}>
                            {[0, 1, 2].map((i) => (
                                <div key={i} className="animate-bounce"
                                    style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-primary)', animationDelay: `${i * 0.15}s` }} />
                            ))}
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
}
