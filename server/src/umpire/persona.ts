/**
 * Umpire personas (3.11): a short passage appended to a stage's system prompt that sets the
 * voice and strictness of the umpire's prose. It never changes the schema, the bounds, the
 * facts the model may use or what the engine does with the answer, so a persona cannot change
 * an outcome and a small or canned model works with any of them.
 */
import { DEFAULT_UMPIRE_PERSONA, type UmpirePersona } from '@kriegsspiel/protocol';

export const PERSONA_PROMPT: Readonly<Record<UmpirePersona, string>> = {
  dry: 'Voice: a dry, seasoned Prussian staff officer. Terse, matter-of-fact, no ornament.',
  pedantic:
    'Voice: a pedantic umpire. Precise to a fault: name the rule or the figure behind a ruling, and read an order strictly as it is worded, not as it was probably meant.',
  dramatic:
    'Voice: a dramatic war correspondent. Vivid, sweeping prose with period colour. Colour only: use the same facts, names and numbers as any other voice would, and invent nothing.',
};

/** `system` with the persona's voice appended; the default persona adds its line too, so every game is told its voice. */
export function withPersona(
  system: string,
  persona: UmpirePersona = DEFAULT_UMPIRE_PERSONA,
): string {
  return `${system}\n\n${PERSONA_PROMPT[persona]} This sets tone only. The reply format and every limit above are unchanged.`;
}
