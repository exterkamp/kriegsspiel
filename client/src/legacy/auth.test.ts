import { describe, expect, it } from 'vitest';
import { startGuest } from './auth';

const respond = (status: number, body: string): typeof fetch =>
  (async () => new Response(body, { status })) as unknown as typeof fetch;

describe('startGuest', () => {
  it('resolves to nothing on success', async () => {
    expect(await startGuest(respond(200, '{}'))).toBeUndefined();
  });

  it('says when the rate limit ends, in local time', async () => {
    const retryAt = new Date(2030, 0, 1, 14, 5).getTime();
    const hhmm = new Date(retryAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const msg = await startGuest(respond(429, JSON.stringify({ error: 'rate_limited', retryAt })));
    expect(msg).toBe(`Too many guests have started from this address. Try again at ${hhmm}.`);
  });

  it.each([
    ['no retryAt', '{}'],
    ['an invalid retryAt', JSON.stringify({ retryAt: 'soon' })],
    ['a body that is not JSON', 'Too Many Requests'],
  ])('falls back to "Try again later." with %s', async (_name, body) => {
    expect(await startGuest(respond(429, body))).toBe(
      'Too many guests have started from this address. Try again later.',
    );
  });
});
