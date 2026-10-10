/** Settings read from the environment by `main.ts`, kept here so tests start the app the same way. */

/** Scripted sides are played by the built-in opponent unless `SCRIPTED_OPPONENTS` is `0`, `false` or `off`. */
export function scriptedOpponentsFromEnv(env: Record<string, string | undefined>): boolean {
  const v = env.SCRIPTED_OPPONENTS?.trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off');
}
