import { useState, type ReactNode } from 'react';
import { dateLocale, t } from './i18n';
import { displayName, S, setState, useStore } from './store';

/* ------------------------------------------------------------------ */
/* Dates et tailles                                                    */
/* ------------------------------------------------------------------ */
export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const time = formatTime(iso);
  if (d.toDateString() === now.toDateString()) return t("Aujourd'hui à {time}", { time });
  if (d.toDateString() === yesterday.toDateString()) return t('Hier à {time}', { time });
  return `${d.toLocaleDateString(dateLocale())} ${time}`;
}

export function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatLongDate(iso: string | null) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`;
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  if (bytes < 1024 * 1024) return `${fmt(Math.round((bytes / 1024) * 10) / 10)} Ko`;
  if (bytes < 1024 * 1024 * 1024) return `${fmt(Math.round((bytes / 1024 / 1024) * 10) / 10)} Mo`;
  return `${fmt(Math.round((bytes / 1024 / 1024 / 1024) * 100) / 100)} Go`;
}

export function sameDay(a: string, b: string) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

/* ------------------------------------------------------------------ */
/* Rendu du texte des messages (Markdown simplifié, sans HTML brut)    */
/* ------------------------------------------------------------------ */
function Spoiler({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className={`spoiler ${open ? 'revealed' : ''}`} onClick={() => setOpen(true)} title={open ? undefined : t('Spoiler — clique pour révéler')}>
      {children}
    </span>
  );
}

function Mention({ userId, serverId }: { userId: string; serverId: string | null }) {
  const name = useStore((s) => displayName(s, userId, serverId));
  return (
    <span
      className="mention-chip"
      onClick={(e) => {
        const r = (e.target as HTMLElement).getBoundingClientRect();
        setState((s) => void (s.popout = { userId, serverId, x: r.right + 8, y: r.top }));
      }}
    >
      @{name}
    </span>
  );
}

export function CustomEmoji({ id, name, animated, size = 22 }: { id: string; name: string; animated?: boolean; size?: number }) {
  return (
    <img
      src={`/api/emojis/${id}`}
      alt={`:${name}:`}
      title={`:${name}:`}
      draggable={false}
      className="inline-block align-[-0.3em] object-contain"
      style={{ width: size, height: size }}
      data-animated={animated ? '1' : undefined}
    />
  );
}

type Rule = { re: RegExp; render: (m: RegExpExecArray, ctx: Ctx, key: number) => ReactNode };
interface Ctx {
  serverId: string | null;
  jumbo: boolean;
}

const RULES: Rule[] = [
  { re: /^`([^`\n]+)`/, render: (m, _c, k) => <code key={k}>{m[1]}</code> },
  { re: /^\*\*([\s\S]+?)\*\*/, render: (m, c, k) => <strong key={k}>{inline(m[1], c)}</strong> },
  { re: /^__([\s\S]+?)__/, render: (m, c, k) => <u key={k}>{inline(m[1], c)}</u> },
  { re: /^\*(?!\s)([\s\S]*?[^\s])\*/, render: (m, c, k) => <em key={k}>{inline(m[1], c)}</em> },
  { re: /^_(?!\s)([\s\S]*?[^\s])_(?![\p{L}\p{N}])/u, render: (m, c, k) => <em key={k}>{inline(m[1], c)}</em> },
  { re: /^~~([\s\S]+?)~~/, render: (m, c, k) => <s key={k}>{inline(m[1], c)}</s> },
  { re: /^\|\|([\s\S]+?)\|\|/, render: (m, c, k) => <Spoiler key={k}>{inline(m[1], c)}</Spoiler> },
  { re: /^<@!?(\d{5,25})>/, render: (m, c, k) => <Mention key={k} userId={m[1]} serverId={c.serverId} /> },
  { re: /^<(a?):(\w{2,32}):(\d{5,25})>/, render: (m, c, k) => <CustomEmoji key={k} id={m[3]} name={m[2]} animated={!!m[1]} size={c.jumbo ? 48 : 22} /> },
  {
    re: /^<(https?:\/\/[^\s>]+)>/,
    render: (m, _c, k) => (
      <a key={k} href={m[1]} target="_blank" rel="noopener noreferrer">
        {m[1]}
      </a>
    ),
  },
  {
    re: /^https?:\/\/[^\s<]+[^\s<.,:;"')\]!?*_~|]/,
    render: (m, _c, k) => (
      <a key={k} href={m[0]} target="_blank" rel="noopener noreferrer">
        {m[0]}
      </a>
    ),
  },
  { re: /^@(everyone|here)\b/, render: (m, _c, k) => <span key={k} className="mention-chip">@{m[1]}</span> },
];

const SPECIAL = /[`*_~|<h@]/;

function inline(text: string, ctx: Ctx): ReactNode[] {
  const out: ReactNode[] = [];
  let buf = '';
  let i = 0;
  let key = 0;
  while (i < text.length) {
    const ch = text[i];
    if (SPECIAL.test(ch)) {
      const rest = text.slice(i);
      let matched = false;
      for (const rule of RULES) {
        const m = rule.re.exec(rest);
        if (m) {
          if (buf) out.push(buf), (buf = '');
          out.push(rule.render(m, ctx, key++));
          i += m[0].length;
          matched = true;
          break;
        }
      }
      if (matched) continue;
    }
    if (ch === '\\' && i + 1 < text.length && /[`*_~|<>\\]/.test(text[i + 1])) {
      buf += text[i + 1];
      i += 2;
      continue;
    }
    buf += ch;
    i++;
  }
  if (buf) out.push(buf);
  return out;
}

const EMOJI_ONLY = /^(?:\s*(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*|\p{Regional_Indicator}{2}|<a?:\w{2,32}:\d+>)\s*){1,27}$/u;

export function renderMarkdown(content: string, serverId: string | null): ReactNode {
  const jumbo = EMOJI_ONLY.test(content);
  const ctx: Ctx = { serverId, jumbo };
  const blocks = content.split(/(```[\s\S]*?```)/g);
  const nodes: ReactNode[] = [];
  blocks.forEach((block, bi) => {
    if (bi % 2 === 1) {
      const body = block.slice(3, -3).replace(/^[a-zA-Z0-9+#-]*\n/, '');
      nodes.push(<pre key={`c${bi}`}>{body.replace(/\n$/, '')}</pre>);
      return;
    }
    const lines = block.split('\n');
    let quote: string[] = [];
    const flushQuote = (k: string) => {
      if (quote.length) {
        nodes.push(<blockquote key={k}>{inline(quote.join('\n'), ctx)}</blockquote>);
        quote = [];
      }
    };
    lines.forEach((line, li) => {
      const k = `${bi}-${li}`;
      if (/^> /.test(line) || line === '>') {
        quote.push(line.replace(/^> ?/, ''));
        return;
      }
      flushQuote(`q${k}`);
      const h = /^(#{1,3}) (.+)$/.exec(line);
      if (h) {
        const size = h[1].length === 1 ? 'text-2xl' : h[1].length === 2 ? 'text-xl' : 'text-lg';
        nodes.push(
          <div key={k} className={`${size} font-bold mt-1`}>
            {inline(h[2], ctx)}
          </div>,
        );
        return;
      }
      const li2 = /^\s*[-*] (.+)$/.exec(line);
      if (li2) {
        nodes.push(
          <div key={k} className="pl-4 relative before:content-['•'] before:absolute before:left-1">
            {inline(li2[1], ctx)}
          </div>,
        );
        return;
      }
      nodes.push(
        <span key={k}>
          {inline(line, ctx)}
          {li < lines.length - 1 ? '\n' : ''}
        </span>,
      );
    });
    flushQuote(`q${bi}-end`);
  });
  return <div className={`msg-content whitespace-pre-wrap break-words ${jumbo ? 'text-5xl leading-tight' : ''}`}>{nodes}</div>;
}

/** Aperçu texte brut (réponses, notifications). */
export function plainPreview(content: string): string {
  const s = S();
  return content
    .replace(/<@!?(\d+)>/g, (_, id) => '@' + displayName(s, id))
    .replace(/<a?:(\w+):\d+>/g, ':$1:')
    .replace(/[*_~`|]{1,3}/g, '');
}
