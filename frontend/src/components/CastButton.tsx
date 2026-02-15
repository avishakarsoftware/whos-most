interface CastButtonProps {
    roomCode: string;
}

export default function CastButton({ roomCode }: CastButtonProps) {
    const spectatorUrl = `/spectator?room=${roomCode}`;

    return (
        <button
            onClick={() => window.open(spectatorUrl, 'WhosMostTV', 'fullscreen=yes,toolbar=no,menubar=no,scrollbars=no')}
            className="btn btn-secondary w-full"
        >
            Open TV View
        </button>
    );
}
