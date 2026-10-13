/**
 * Umpire settings chosen when a game is made (story 3.11): the rigid-to-free dial and the
 * umpire's persona. Shared so the server validates what the new-game screen offers.
 *
 * The dial changes only how far the judge may depart from the tables (the engine's judgment
 * cap). The persona changes only the voice and strictness of the umpire's prose. Neither
 * changes a schema, and a persona never changes an outcome.
 */
export const DIALS = ['rigid', 'standard', 'free'] as const;
export type UmpireDial = (typeof DIALS)[number];
export const DEFAULT_UMPIRE_DIAL: UmpireDial = 'standard';

export const PERSONAS = ['dry', 'pedantic', 'dramatic'] as const;
export type UmpirePersona = (typeof PERSONAS)[number];
export const DEFAULT_UMPIRE_PERSONA: UmpirePersona = 'dry';

export interface UmpireSettings {
  dial: UmpireDial;
  persona: UmpirePersona;
}

export const DIAL_INFO: Readonly<Record<UmpireDial, { label: string; description: string }>> = {
  rigid: {
    label: 'Rigid',
    description:
      'The tables decide. Dice and the rules settle every fight and march, and the umpire never bends a result by judgment.',
  },
  standard: {
    label: 'Standard',
    description:
      'The tables decide, and where the rules are silent the umpire may nudge a result by up to a quarter either way.',
  },
  free: {
    label: 'Free',
    description:
      'The umpire is given wider room: where the rules are silent the umpire may swing a result by up to two fifths either way. Every ruling is still bounded, recorded and followed in like cases.',
  },
};

export const PERSONA_INFO: Readonly<Record<UmpirePersona, { label: string; description: string }>> =
  {
    dry: {
      label: 'Dry staff officer',
      description:
        'Terse and matter-of-fact reports and rulings, as from a seasoned staff officer.',
    },
    pedantic: {
      label: 'Pedantic umpire',
      description:
        'Precise to a fault: cites the rule, the figures and the exact wording. Strict about what an order actually says.',
    },
    dramatic: {
      label: 'Dramatic correspondent',
      description:
        'Vivid, sweeping prose in the manner of a war correspondent. Only the colour changes; the facts and the results are the same.',
    },
  };
