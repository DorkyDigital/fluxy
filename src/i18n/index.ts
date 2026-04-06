import fs from 'fs';
import path from 'path';

type Json = Record<string, unknown>;
type Vars = Record<string, string | number | boolean | null | undefined>;

function localesDir(): string {
  return path.join(__dirname, '..', 'locales');
}

function loadLocales(): Record<string, Json> {
  const dir = localesDir();
  const out: Record<string, Json> = {};
  if (!fs.existsSync(dir)) {
    throw new Error(`Locales directory missing: ${dir}`);
  }
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const key = f.replace(/\.json$/i, '').toLowerCase();
    const full = path.join(dir, f);
    const raw = fs.readFileSync(full, 'utf-8');
    out[key] = JSON.parse(raw) as Json;
  }
  if (!out.en) {
    throw new Error('Missing src/locales/en.json (required fallback)');
  }
  return out;
}

const LOCALES = loadLocales();

export function listLocales(): string[] {
  return Object.keys(LOCALES).sort();
}

export function normalizeLocale(input: unknown): string {
  const raw = typeof input === 'string' ? input.trim().toLowerCase() : '';
  if (!raw) return 'en';
  if (raw in LOCALES) return raw;
  const parts = raw.split('-');
  if (parts.length >= 2) {
    const primary = parts[0];
    if (primary in LOCALES) return primary;
  }
  return 'en';
}

function getByPath(obj: unknown, key: string): unknown {
  const parts = key.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\$\{([^}]+)\}|\{([a-zA-Z0-9_]+)\}/g, (_, templateKey: string | undefined, braceKey: string | undefined) => {
    const key = templateKey ?? braceKey;
    const v = key ? vars[key] : undefined;
    if (v === null || v === undefined) {
      return templateKey ? `\${${key}}` : `{${key}}`;
    }
    return String(v);
  });
}

export function t(locale: unknown, key: string, vars?: Vars): string {
  const loc = normalizeLocale(locale);
  const fromLocale = getByPath(LOCALES[loc], key);
  const fallback = fromLocale === undefined ? getByPath(LOCALES.en, key) : fromLocale;
  const str = typeof fallback === 'string' ? fallback : key;
  return interpolate(str, vars);
}
