/** The new-game screen's two calls: the scenario list and game creation. */
import { createErrorMessage, type CreateRequest, type ScenarioOptions } from './newGame.js';

type Fetch = typeof fetch;

export async function fetchScenarioOptions(f: Fetch = fetch): Promise<ScenarioOptions> {
  const res = await f('/scenarios');
  if (!res.ok) throw new Error(`Could not load the scenarios (${res.status}).`);
  const body = (await res.json()) as {
    scenarios: ScenarioOptions['scenarios'];
    opponent?: ScenarioOptions['opponent'];
  };
  return { scenarios: body.scenarios, opponent: body.opponent };
}

/** Makes and starts a game; resolves to its id. Throws an Error with a readable message. */
export async function createGame(req: CreateRequest, f: Fetch = fetch): Promise<string> {
  let res: Response;
  try {
    res = await f('/games', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    });
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }
  if (!res.ok) {
    let code = '';
    let message: string | undefined;
    try {
      const b = (await res.json()) as { error?: string; message?: string };
      code = b.error ?? '';
      message = b.message;
    } catch {
      // no body
    }
    throw new Error(createErrorMessage(res.status, code, message));
  }
  return ((await res.json()) as { id: string }).id;
}
