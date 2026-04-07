import * as GlitchTipClient from '@sentry/react';

const dsn = import.meta.env.VITE_GLITCHTIP_DSN || '';
const environment = import.meta.env.VITE_GLITCHTIP_ENVIRONMENT || import.meta.env.MODE || 'production';

if (dsn) {
  GlitchTipClient.init({
    dsn,
    environment,
    release: `fluxy-dashboard@2.0.0`,

    tracesSampleRate: 0.1,

    tracePropagationTargets: ['localhost', /^\/api/],

    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    integrations: [
      GlitchTipClient.replayIntegration({
        maskAllText: false,
        maskAllInputs: true,
        blockAllMedia: false,
      }),
      GlitchTipClient.browserTracingIntegration(),
    ],

    beforeSend(event) {
      if (!event.exception?.values?.[0]?.stacktrace) return null;

      const message = event.exception?.values?.[0]?.value || '';
      if (message.includes('ResizeObserver')) return null;

      return event;
    },

    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.category === 'console' && breadcrumb.level === 'log') return null;
      return breadcrumb;
    },
  });

  console.log(`[GlitchTip] Dashboard SDK initialized (env: ${environment})`);
} else {
  console.log('[GlitchTip] No VITE_GLITCHTIP_DSN - dashboard error tracking disabled');
}

export { GlitchTipClient as GlitchTip };
