import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import type { DB } from './db.js';

/**
 * Aperçus de liens (Open Graph) avec protection SSRF :
 *  - seuls http/https sont autorisés ;
 *  - la résolution DNS refuse toutes les adresses privées / locales (y compris après redirection) ;
 *  - taille et durée de téléchargement limitées.
 */
export interface Embed {
  type: 'link' | 'image' | 'video';
  url: string;
  title?: string;
  description?: string;
  siteName?: string;
  image?: string;
  color?: string;
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const low = ip.toLowerCase();
  if (low.startsWith('::ffff:')) return isPrivateIp(low.slice(7));
  return low === '::' || low === '::1' || low.startsWith('fc') || low.startsWith('fd') || low.startsWith('fe80');
}

const safeLookup: typeof dns.lookup = ((hostname: string, options: any, cb: any) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses: any) => {
    if (err) return cb(err);
    const list = (Array.isArray(addresses) ? addresses : [{ address: addresses, family: 4 }]) as dns.LookupAddress[];
    const bad = list.find((a) => isPrivateIp(a.address));
    if (bad || !list.length) return cb(new Error('Adresse interdite'));
    if (options?.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}) as any;

/** Autorités de certification : celles de Node + celles du système (proxys d'entreprise, antivirus…). */
let caCache: string[] | null = null;
function trustedCAs(): string[] {
  if (caCache) return caCache;
  let system: string[] = [];
  try {
    system = (tls as unknown as { getCACertificates?: (t: string) => string[] }).getCACertificates?.('system') ?? [];
  } catch {
    system = [];
  }
  caCache = [...new Set([...tls.rootCertificates, ...system])];
  return caCache;
}

function fetchLimited(url: string, redirects = 3): Promise<{ url: string; type: string; body: string }> {
  return new Promise((resolve, reject) => {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return reject(new Error('URL invalide'));
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return reject(new Error('Protocole interdit'));
    if (net.isIP(u.hostname) && isPrivateIp(u.hostname)) return reject(new Error('Adresse interdite'));
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.get(
      u,
      {
        lookup: safeLookup,
        timeout: 5000,
        ...(u.protocol === 'https:' ? { ca: trustedCAs() } : {}),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; endBuyBot/1.0; +link-preview)',
          Accept: 'text/html,application/xhtml+xml,image/*;q=0.8,*/*;q=0.5',
          'Accept-Language': 'fr,en;q=0.8',
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (redirects <= 0) return reject(new Error('Trop de redirections'));
          return resolve(fetchLimited(new URL(res.headers.location, u).toString(), redirects - 1));
        }
        if (status >= 400) {
          res.resume();
          return reject(new Error(`HTTP ${status}`));
        }
        const type = String(res.headers['content-type'] || '');
        if (!/text\/html|application\/xhtml/.test(type)) {
          res.destroy();
          return resolve({ url: u.toString(), type, body: '' });
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
          if (body.length > 400_000 || /<\/head>/i.test(body)) res.destroy();
        });
        res.on('close', () => resolve({ url: u.toString(), type, body }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('Délai dépassé')));
    req.on('error', reject);
  });
}

function decodeEntities(s: string) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function metaContent(html: string, keys: string[]): string | undefined {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const key of keys) {
    for (const tag of tags) {
      const prop = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
      if (prop !== key) continue;
      const content = /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
      if (content) return decodeEntities(content).trim();
    }
  }
  return undefined;
}

export async function buildEmbed(url: string): Promise<Embed | null> {
  const res = await fetchLimited(url);
  if (/^image\//.test(res.type)) return { type: 'image', url: res.url, image: res.url };
  if (/^video\//.test(res.type)) return { type: 'video', url: res.url };
  if (!res.body) return null;
  const html = res.body;
  const title = metaContent(html, ['og:title', 'twitter:title']) ?? decodeEntities(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? '').trim();
  const description = metaContent(html, ['og:description', 'twitter:description', 'description']);
  let image = metaContent(html, ['og:image', 'og:image:url', 'twitter:image']);
  if (image) {
    try {
      image = new URL(image, res.url).toString();
      if (!/^https?:/.test(image)) image = undefined;
    } catch {
      image = undefined;
    }
  }
  const siteName = metaContent(html, ['og:site_name']) ?? new URL(res.url).hostname;
  const color = metaContent(html, ['theme-color']);
  if (!title && !description) return null;
  return {
    type: 'link',
    url,
    title: title?.slice(0, 256),
    description: description?.slice(0, 350),
    siteName: siteName?.slice(0, 100),
    image,
    color: color && /^#[0-9a-f]{3,8}$/i.test(color) ? color : undefined,
  };
}

const URL_RE = /https?:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?]/gi;

export function extractUrls(content: string): string[] {
  const stripped = content.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '').replace(/<https?:\/\/[^>]+>/g, '');
  return [...new Set(stripped.match(URL_RE) ?? [])].slice(0, 3);
}

export async function previewsFor(db: DB, urls: string[]): Promise<Embed[]> {
  const out: Embed[] = [];
  for (const url of urls) {
    try {
      const cached = await db.one<{ data: Embed | null; fetched_at: Date }>(
        'SELECT data, fetched_at FROM link_previews WHERE url = $1',
        [url],
      );
      if (cached && Date.now() - new Date(cached.fetched_at).getTime() < 24 * 3600 * 1000) {
        if (cached.data) out.push(cached.data);
        continue;
      }
      let embed: Embed | null = null;
      try {
        embed = await buildEmbed(url);
      } catch (e) {
        // Erreur réseau : on ne met pas en cache, on réessaiera au prochain message.
        console.warn(`[endBuy] aperçu impossible pour ${url} : ${(e as Error).message}`);
        continue;
      }
      await db.query(
        `INSERT INTO link_previews (url, data, fetched_at) VALUES ($1, $2, now())
         ON CONFLICT (url) DO UPDATE SET data = EXCLUDED.data, fetched_at = now()`,
        [url, embed ? JSON.stringify(embed) : null],
      );
      if (embed) out.push(embed);
    } catch (e) {
      console.warn('[endBuy] aperçu de lien', e);
    }
  }
  return out;
}
