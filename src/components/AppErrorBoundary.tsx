import React from 'react';

type State = { failed: boolean; message: string };
export class AppErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { failed: false, message: '' };
  static getDerivedStateFromError(error: Error): State {
    return { failed: true, message: error.message || 'Unexpected application error.' };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('TRIPP application error', error, info.componentStack);
  }
  render() {
    if (this.state.failed) {
      return <main role="alert" style={{ maxWidth: 640, margin: '64px auto', padding: 24, fontFamily: 'system-ui' }}>
        <h1>TRIPP could not load this view</h1>
        <p>Try refreshing. If the issue persists, contact the TRIPP administrator.</p>
        <button type="button" onClick={() => window.location.reload()}>Reload TRIPP</button>
      </main>;
    }
    return this.props.children;
  }
}
