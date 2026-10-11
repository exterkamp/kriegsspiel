import { InjectionToken, inject } from '@angular/core';
import type { ConferenceRole } from '@legacy/desk/conference';
import type { Courier } from '@legacy/desk/orders';
import { GameService } from './game.service';

/** What the pause panel can ask of the server; each returns false when the link is down. */
export interface PauseActions {
  proposePause(reason?: string): boolean;
  proposeResume(): boolean;
  vote(proposal: string, yes: boolean): boolean;
}

/**
 * What the orders desk needs to sign an order. `text` is the finished wording (addressee and annex included);
 * `eta` is the staff's estimate in game ms. Returns an error to show on the form, or undefined when the order has gone.
 */
export interface OrderSender {
  send(o: { text: string; toName: string; courier: Courier; eta: number | undefined }): string | undefined;
}

/** Sends a staff question; returns false when the link is down. */
export type ConferenceSender = (questionId: string, role: ConferenceRole, question: string) => boolean;

/** Ports the desk views depend on. By default they talk to `GameService`; tests and fixtures provide their own. */
export const ORDER_SENDER = new InjectionToken<OrderSender>('ORDER_SENDER', {
  providedIn: 'root',
  factory: () => {
    const game = inject(GameService);
    return {
      send: (o) =>
        game.sendOrder(
          o.text,
          { toName: o.toName, courier: o.courier, ...(o.eta === undefined ? {} : { etaGame: o.eta }) },
          o.courier,
        ),
    };
  },
});

export const CONFERENCE_SENDER = new InjectionToken<ConferenceSender>('CONFERENCE_SENDER', {
  providedIn: 'root',
  factory: () => {
    const game = inject(GameService);
    return (id, role, question) => game.askStaff(id, role, question);
  },
});

export const PAUSE_ACTIONS = new InjectionToken<PauseActions>('PAUSE_ACTIONS', {
  providedIn: 'root',
  factory: () => {
    const game = inject(GameService);
    return {
      proposePause: (r) => game.proposePause(r),
      proposeResume: () => game.proposeResume(),
      vote: (id, yes) => game.vote(id, yes),
    };
  },
});
