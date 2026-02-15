import { useRef, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import CastButton from '../CastButton';
import { type PlayerInfo } from '../../types';

const AVATAR_COLORS = [
    '#FF006E', '#FF6B6B', '#FF8C42', '#FFD93D', '#00E676',
    '#00BCD4', '#7C4DFF', '#E040FB', '#FF5252', '#64FFDA',
    '#FFAB40', '#B388FF', '#69F0AE', '#FF80AB', '#40C4FF',
];

interface LobbyScreenProps {
    roomCode: string;
    joinUrl: string;
    networkIp: string;
    playerCount: number;
    players: PlayerInfo[];
    onStartGame: () => void;
}

export default function LobbyScreen({ roomCode, joinUrl, networkIp, playerCount, players, onStartGame }: LobbyScreenProps) {
    const prevCountRef = useRef(playerCount);
    const justJoined = playerCount > prevCountRef.current;

    useEffect(() => {
        prevCountRef.current = playerCount;
    }, [playerCount]);

    const minPlayers = 3;
    const canStart = playerCount >= minPlayers;

    return (
        <div className="min-h-dvh flex flex-col items-center justify-center container-responsive safe-top safe-bottom animate-in">
            <div className="screen-hero">
                <h1 className="hero-title">Game Lobby</h1>
                <p className="hero-subtitle">Share the code below to invite players</p>
            </div>

            <div style={{ textAlign: 'center', marginBottom: 16 }}>
                <div className="qr-container">
                    <QRCodeSVG value={joinUrl} size={180} bgColor="white" fgColor="#000000" level="H" />
                </div>
            </div>

            <div className="room-code" style={{ marginBottom: 8, textAlign: 'center' }}>{roomCode}</div>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: 14, marginBottom: 24, textAlign: 'center' }}>{networkIp}:5173/join</p>

            {/* Players section */}
            <div style={{ width: '100%', marginBottom: 12 }}>
                {playerCount === 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '8px 0' }}>
                        <p style={{ color: 'var(--color-text-secondary)', fontWeight: 500, marginBottom: 12 }} className="animate-pulse">Waiting for players...</p>
                        <div style={{ display: 'flex', gap: 6 }}>
                            {[0, 1, 2].map((i) => (
                                <div key={i} className="animate-bounce"
                                    style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-text-secondary)', animationDelay: `${i * 0.15}s` }} />
                            ))}
                        </div>
                    </div>
                ) : (
                    <>
                        <p style={{ textAlign: 'center', marginBottom: 12 }} className={justJoined ? 'lobby-count-bump' : ''} key={playerCount}>
                            <span style={{ fontSize: '1.5rem', fontWeight: 700 }}>{playerCount}</span>{' '}
                            <span style={{ color: 'var(--color-text-secondary)', fontWeight: 500 }}>player{playerCount !== 1 ? 's' : ''}</span>
                            {!canStart && (
                                <span style={{ fontSize: 12, color: 'var(--color-warning)', marginLeft: 8 }}>
                                    (need {minPlayers - playerCount} more)
                                </span>
                            )}
                        </p>
                        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}>
                            {players.map((player, i) => (
                                <div key={player.nickname} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: 9999, background: 'var(--color-card)' }}>
                                    <div
                                        style={{
                                            width: 36, height: 36, minWidth: 36, borderRadius: '50%',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            backgroundColor: AVATAR_COLORS[i % AVATAR_COLORS.length],
                                        }}
                                    >
                                        <span style={{ fontSize: '1.25rem', lineHeight: 1 }}>{player.avatar || player.nickname.slice(0, 2).toUpperCase()}</span>
                                    </div>
                                    <span style={{ fontSize: '1rem', fontWeight: 500 }}>{player.nickname}</span>
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </div>

            <div style={{ width: '100%', marginBottom: 16 }}>
                <CastButton roomCode={roomCode} />
            </div>

            <button
                onClick={onStartGame}
                disabled={!canStart}
                className="btn btn-primary btn-glow w-full"
            >
                {canStart ? 'Start Game' : `Need ${minPlayers} Players to Start`}
            </button>
        </div>
    );
}
