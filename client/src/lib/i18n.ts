import { EN } from './i18n-en';

/**
 * Internationalisation légère : le français est la langue source (les clés SONT les textes français),
 * l'anglais est fourni par un dictionnaire. Les variables s'écrivent {nom}.
 */
export type Locale = 'fr' | 'en';

let locale: Locale = (() => {
  try {
    const saved = localStorage.getItem('endbuy.locale');
    if (saved === 'fr' || saved === 'en') return saved;
  } catch {
    /* ignoré */
  }
  return 'fr';
})();

export function getLocale(): Locale {
  return locale;
}

export function setLocale(l: Locale) {
  locale = l;
  try {
    localStorage.setItem('endbuy.locale', l);
  } catch {
    /* ignoré */
  }
  document.documentElement.lang = l;
}

export function t(fr: string, vars?: Record<string, string | number>): string {
  let s = locale === 'en' ? EN[fr] ?? fr : fr;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Libellé pluriel simple. */
export function tn(n: number, one: string, many: string, vars: Record<string, string | number> = {}) {
  return t(n === 1 ? one : many, { n, ...vars });
}

export function dateLocale() {
  return locale === 'en' ? 'en-US' : 'fr-FR';
}
