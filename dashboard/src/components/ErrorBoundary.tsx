import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { GlitchTip } from '../lib/glitchtip';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, errorInfo.componentStack);
    GlitchTip.captureException(error, {
      contexts: { react: { componentStack: errorInfo.componentStack } },
    });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex items-center justify-center min-h-[400px] p-6">
          <Card className="max-w-md w-full">
            <CardContent className="p-8 text-center space-y-4">
              <div className="flex justify-center">
                <div className="rounded-full bg-red-500/10 p-3">
                  <AlertTriangle className="h-8 w-8 text-red-400" />
                </div>
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Something went wrong</h2>
                <p className="text-sm text-gray-400 mt-1">
                  {this.state.error?.message || 'An unexpected error occurred.'}
                </p>
              </div>
              <div className="flex justify-center gap-3">
                <Button variant="outline" size="sm" onClick={this.handleReset}>
                  <RefreshCw className="h-4 w-4 mr-1.5" />
                  Try Again
                </Button>
                <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                  Reload Page
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}
