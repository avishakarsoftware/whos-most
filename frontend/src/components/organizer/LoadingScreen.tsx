export default function LoadingScreen() {
    return (
        <div className="min-h-dvh flex flex-col items-center justify-center container-responsive safe-top safe-bottom">
            <div className="loading-ring" />
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: 24, marginBottom: 8, textAlign: 'center' }}>
                Generating Prompts
            </h2>
            <p style={{ color: 'var(--color-text-secondary)', textAlign: 'center', fontSize: 14 }}>
                AI is crafting your "Who's Most Likely To" prompts...
            </p>
        </div>
    );
}
