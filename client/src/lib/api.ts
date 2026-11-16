import { t } from './i18n';

/** Client HTTP de l'API endBuy (cookies de session httpOnly + en-tête anti-CSRF). */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public data?: any,
  ) {
    super(message);
  }
}

async function parse(res: Response) {
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const message = (body && body.message) || `Erreur ${res.status}`;
    throw new ApiError(res.status, t(message), body?.code, body);
  }
  return body;
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'X-Requested-With': 'endBuy' };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch('/api' + path, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, t('Impossible de joindre le serveur endBuy. Vérifie ta connexion.'), 'NETWORK');
  }
  return parse(res);
}

export const get = <T = any>(p: string) => api<T>('GET', p);
export const post = <T = any>(p: string, b?: unknown) => api<T>('POST', p, b ?? {});
export const patch = <T = any>(p: string, b?: unknown) => api<T>('PATCH', p, b ?? {});
export const put = <T = any>(p: string, b?: unknown) => api<T>('PUT', p, b ?? {});
export const del = <T = any>(p: string, b?: unknown) => api<T>('DELETE', p, b);

/** Téléversement avec progression (XHR). */
export function upload<T = any>(
  path: string,
  form: FormData,
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api' + path);
    xhr.setRequestHeader('X-Requested-With', 'endBuy');
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body: any = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* ignoré */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new ApiError(xhr.status, t(body?.message || `Erreur ${xhr.status}`), body?.code, body));
    };
    xhr.onerror = () => reject(new ApiError(0, t('Échec du téléversement (réseau).'), 'NETWORK'));
    xhr.onabort = () => reject(new ApiError(0, 'Téléversement annulé.', 'ABORTED'));
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(form);
  });
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
