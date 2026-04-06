import { t } from '../i18n';

export function isPermDenied(error: any): boolean {
  if (!error) return false;
  return (
    error?.code === 50013 ||
    error?.statusCode === 403 ||
    /permissions?/i.test(error?.message || '')
  );
}

const PERM_MESSAGE_KEYS = {
  kick: 'auditCatalog.utils.permError.kick',
  ban: 'auditCatalog.utils.permError.ban',
  unban: 'auditCatalog.utils.permError.unban',
  timeout: 'auditCatalog.utils.permError.timeout',
  mute: 'auditCatalog.utils.permError.mute',
  unmute: 'auditCatalog.utils.permError.unmute',
  clear: 'auditCatalog.utils.permError.clear',
} as const;

export type PermMessageAction = keyof typeof PERM_MESSAGE_KEYS;

export function permMessage(locale: unknown, action: PermMessageAction): string {
  return t(locale, PERM_MESSAGE_KEYS[action]);
}
