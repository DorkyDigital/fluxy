import { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

export function AuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { onLogin } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const code = searchParams.get('code');
    if (!code) {
      setError('No authorization code received');
      return;
    }

    const state = localStorage.getItem('fluxy_oauth_state');
    localStorage.removeItem('fluxy_oauth_state');
    if (!state) {
      setError('Missing OAuth state - please try logging in again');
      return;
    }

    (async () => {
      try {
        await api.post('/auth/callback', { code, state });
        await onLogin();
        navigate('/', { replace: true });
      } catch (err: any) {
        setError(err.message || 'Authentication failed');
      }
    })();
  }, [searchParams, navigate, onLogin]);

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-4">
          <p className="text-red-400 text-lg">Authentication failed</p>
          <p className="text-gray-400">{error}</p>
          <a href="/login" className="text-blue-400 hover:underline">Try again</a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center space-y-4">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto" />
        <p className="text-gray-400">Authenticating...</p>
      </div>
    </div>
  );
}
