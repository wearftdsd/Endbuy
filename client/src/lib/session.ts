import { get, patch, post } from './api';
import { gateway } from './gateway';
import { setLocale, t } from './i18n';
import { voice } from './rtc';
import { resetSessionState, S, setState, toast } from './store';
import type { SelfUser, Settings } from './types';

voice.setSender((op, d) => gateway.send(op, d));
gateway.onSessionRevoked = () => {
  voice.leave(false, false);
  resetSessionState();
  setState((s) => {
    s.me = null;
    s.authChecked = true;
  });
  toast(t('Ta session a expiré ou a été révoquée. Reconnecte-toi.'), 'error');
};

export async function checkSession() {
  try {
    const { user } = await get<{ user: SelfUser }>('/auth/me');
    startSession(user);
  } catch {
    setState((s) => {
      s.me = null;
      s.authChecked = true;
    });
  }
}

export function startSession(user: SelfUser) {
  setState((s) => {
    s.me = user;
    s.authChecked = true;
  });
  setLocale(user.settings.locale);
  gateway.stop();
  gateway.start();
}

export async function logout() {
  voice.leave(true, false);
  gateway.stop();
  try {
    await post('/auth/logout');
  } catch {
    /* ignoré */
  }
  resetSessionState();
  setState((s) => {
    s.me = null;
  });
}

/** Met à jour les paramètres (optimiste, puis confirmé par le serveur). */
export async function updateSettings(partial: Partial<Settings>) {
  const me = S().me;
  if (!me) return;
  const next = { ...me.settings, ...partial, notifications: { ...me.settings.notifications, ...(partial.notifications ?? {}) } };
  setState((s) => {
    if (s.me) s.me.settings = next;
  });
  if (partial.locale) setLocale(partial.locale);
  try {
    await patch('/users/@me', { settings: next });
  } catch (e) {
    toast(String((e as Error).message), 'error');
  }
}

export function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}
