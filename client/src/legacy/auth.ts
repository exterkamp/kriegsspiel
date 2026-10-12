/** Sign-in for the page: the signed-in user, the magic-link form, sign-out and account deletion. */

export interface Me {
  id: string;
  email: string;
  /** A guest session (D17c): no real address, games kept in this browser until the player signs in. */
  guest?: boolean;
}

/** The signed-in user, or undefined when there is no valid session. */
export async function fetchMe(fetchFn: typeof fetch = fetch): Promise<Me | undefined> {
  const res = await fetchFn('/auth/me', { credentials: 'same-origin' });
  return res.ok ? ((await res.json()) as Me) : undefined;
}

/** Asks the server to mail a login link. Resolves to an error message, or undefined on success. */
export async function requestLink(
  email: string,
  fetchFn: typeof fetch = fetch,
): Promise<string | undefined> {
  const res = await fetchFn('/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (res.status === 202) return undefined;
  if (res.status === 429) return 'Too many requests. Try again later.';
  if (res.status === 400) return 'That does not look like an email address.';
  return `Could not send the link (${res.status}).`;
}

/** Whether the server lets visitors play as a guest. */
export async function guestEnabled(fetchFn: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchFn('/auth/guest', { credentials: 'same-origin' });
    return res.ok && ((await res.json()) as { enabled?: boolean }).enabled === true;
  } catch {
    return false;
  }
}

/** Whether the server wants the main menu's Developer tools section shown (`DEV_TOOLS`). Off when it cannot be asked. */
export async function devToolsEnabled(fetchFn: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchFn('/auth/features', { credentials: 'same-origin' });
    return res.ok && ((await res.json()) as { devTools?: boolean }).devTools === true;
  } catch {
    return false;
  }
}

/** Starts a guest session. Resolves to an error message, or undefined on success. */
export async function startGuest(fetchFn: typeof fetch = fetch): Promise<string | undefined> {
  const res = await fetchFn('/auth/guest', { method: 'POST', credentials: 'same-origin' });
  if (res.ok) return undefined;
  if (res.status === 429) {
    const body = (await res.json().catch(() => ({}))) as { retryAt?: number };
    const at = body.retryAt === undefined ? undefined : new Date(body.retryAt);
    const hhmm =
      at && !Number.isNaN(at.getTime())
        ? at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : undefined;
    return hhmm
      ? `Too many guests have started from this address. Try again at ${hhmm}.`
      : 'Too many guests have started from this address. Try again later.';
  }
  if (res.status === 404) return 'Guest play is turned off on this server.';
  return `Could not start a guest session (${res.status}).`;
}

export async function signOut(fetchFn: typeof fetch = fetch): Promise<void> {
  await fetchFn('/auth/logout', { method: 'POST' });
}

export async function deleteAccount(fetchFn: typeof fetch = fetch): Promise<boolean> {
  return (await fetchFn('/auth/account', { method: 'DELETE' })).ok;
}

/** Shows an email form over the page and resolves once a link has been requested. */
export function showLogin(app: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    const box = document.createElement('form');
    box.id = 'login';
    box.innerHTML = `
      <b>Sign in to Kriegsspiel</b>
      <label>Email <input id="login-email" type="email" required autocomplete="email" /></label>
      <button type="submit">Send me a login link</button>
      <span id="login-msg" role="status"></span>`;
    app.append(box);
    const msg = box.querySelector<HTMLElement>('#login-msg')!;
    box.addEventListener('submit', (e) => {
      e.preventDefault();
      const email = box.querySelector<HTMLInputElement>('#login-email')!.value.trim();
      void requestLink(email).then((err) => {
        msg.textContent =
          err ?? `Check ${email} for your login link, then open it in this browser.`;
        if (!err) resolve();
      });
    });
  });
}

/** A small bar with the user's address, a sign-out button and a delete-account button. */
export function showAccountBar(app: HTMLElement, me: Me, onGone: () => void): void {
  const bar = document.createElement('div');
  bar.id = 'account';
  const who = document.createElement('span');
  who.textContent = me.email;
  const games = document.createElement('a');
  games.href = '/?lobby=1';
  games.textContent = 'Games';
  const out = document.createElement('button');
  out.textContent = 'Sign out';
  out.addEventListener('click', () => void signOut().then(onGone));
  const del = document.createElement('button');
  del.textContent = 'Delete account';
  del.addEventListener('click', () => {
    if (!confirm('Delete your account and leave your games? This cannot be undone.')) return;
    void deleteAccount().then((ok) => ok && onGone());
  });
  bar.append(who, games, out, del);
  app.append(bar);
}
