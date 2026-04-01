import dotenv from 'dotenv';
import * as GlitchTip from '@sentry/node';

dotenv.config();

const dsn = process.env.GLITCHTIP_DSN || '';
const environment = process.env.GLITCHTIP_ENVIRONMENT || process.env.NODE_ENV || 'production';
const debug = process.env.GLITCHTIP_DEBUG === 'true';

if (dsn) {
  GlitchTip.init({
    dsn,
    environment,
    release: `fluxy@2.0.0`,
    tracesSampleRate: 0,
    sendDefaultPii: true,
    debug,
  });
  console.log(`[GlitchTip] SDK initialized (dsn: ${dsn.substring(0, 30)}...)`);

  GlitchTip.captureMessage('Fluxy process started', { level: 'info', tags: { source: 'startup' } });
  GlitchTip.flush(5000).then((flushed) => {
    if (flushed) {
      console.log('[GlitchTip] Startup event sent successfully');
    } else {
      console.error('[GlitchTip] WARNING: Failed to flush startup event - events may not be reaching the collector');
    }
  }).catch((err) => {
    console.error('[GlitchTip] Flush error:', err);
  });
} else {
  console.log('[GlitchTip] No GLITCHTIP_DSN found in environment - disabled');
}
