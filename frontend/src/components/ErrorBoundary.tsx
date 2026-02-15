import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('ErrorBoundary caught:', error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="page-container">
                    <div className="text-5xl mb-4">&#x26A0;</div>
                    <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 8 }}>Something went wrong</h2>
                    <p style={{ color: 'var(--color-text-secondary)', marginBottom: 24 }}>
                        {this.state.error?.message || 'An unexpected error occurred'}
                    </p>
                    <button onClick={() => window.location.reload()} className="btn btn-primary">
                        Reload App
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}
