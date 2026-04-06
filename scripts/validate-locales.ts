import fs from 'fs';
import path from 'path';

type Json = Record<string, any>;
const OPTIONAL_ENGLISH_FALLBACK_PREFIXES = ['auditCatalog.'];

function isObject(v: any): v is Record<string, any> {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function flatten(obj: Json, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') {
      out[key] = v;
    } else if (isObject(v)) {
      Object.assign(out, flatten(v, key));
    }
  }
  return out;
}

function placeholders(str: string): Set<string> {
  const set = new Set<string>();
  const re = /\{([a-zA-Z0-9_]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(str))) set.add(m[1]);
  return set;
}

function loadJson(p: string): Json {
  const raw = fs.readFileSync(p, 'utf-8');
  return JSON.parse(raw);
}

function isOptionalEnglishFallbackKey(key: string): boolean {
  return OPTIONAL_ENGLISH_FALLBACK_PREFIXES.some(prefix => key.startsWith(prefix));
}

function main() {
  const localesDir = path.join(process.cwd(), 'src', 'locales');
  const files = fs.readdirSync(localesDir).filter(f => f.endsWith('.json'));
  if (!files.includes('en.json')) {
    console.error('Missing src/locales/en.json');
    process.exit(1);
  }

  const enPath = path.join(localesDir, 'en.json');
  const enFlat = flatten(loadJson(enPath));
  const enKeys = Object.keys(enFlat).sort();

  let ok = true;

  for (const file of files) {
    const loc = file.replace(/\.json$/, '');
    const locPath = path.join(localesDir, file);
    const flat = flatten(loadJson(locPath));

    const keys = Object.keys(flat).sort();
    const missing = enKeys.filter(k => !(k in flat) && !isOptionalEnglishFallbackKey(k));
    const extra = keys.filter(k => !(k in enFlat));

    if (missing.length) {
      ok = false;
      console.error(`[${loc}] Missing keys (${missing.length}):`);
      for (const k of missing) console.error(`  - ${k}`);
    }
    if (extra.length) {
      ok = false;
      console.error(`[${loc}] Extra keys (${extra.length}):`);
      for (const k of extra) console.error(`  - ${k}`);
    }

    for (const k of enKeys) {
      const base = enFlat[k];
      const cur = flat[k];
      if (typeof cur !== 'string') continue;
      const basePh = placeholders(base);
      const curPh = placeholders(cur);
      for (const p of basePh) {
        if (!curPh.has(p)) {
          ok = false;
          console.error(`[${loc}] Key ${k} missing placeholder {${p}}`);
        }
      }
      for (const p of curPh) {
        if (!basePh.has(p)) {
          ok = false;
          console.error(`[${loc}] Key ${k} has extra placeholder {${p}}`);
        }
      }
    }
  }

  if (!ok) process.exit(1);
  console.log(`Locale validation passed (${files.length} locale file(s)).`);
}

main();
