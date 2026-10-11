/** Delivery of the magic link. The server depends on the interface only. */

export interface Mailer {
  sendLoginLink(to: string, link: string): Promise<void>;
  /** A game notification. The text is fixed per event and holds no game content. */
  sendNotification?(to: string, subject: string, text: string): Promise<void>;
}

/** Dev mailer: writes the link to the log instead of sending it. The link is a credential, so never use it where logs are shared. */
export class LogMailer implements Mailer {
  constructor(private readonly log: (line: string) => void) {}

  async sendLoginLink(to: string, link: string): Promise<void> {
    this.log(`login link for ${to}: ${link}`);
  }

  async sendNotification(to: string, subject: string): Promise<void> {
    this.log(`notification for ${to}: ${subject}`);
  }
}

/**
 * POSTs `{ to, subject, text }` as JSON to a mail gateway (`MAIL_WEBHOOK_URL`), with an optional
 * bearer token. Any HTTP-to-SMTP bridge fits; the server needs no mail library.
 */
export class WebhookMailer implements Mailer {
  constructor(
    private readonly url: string,
    private readonly token?: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async sendLoginLink(to: string, link: string): Promise<void> {
    await this.post(
      to,
      'Your Kriegsspiel login link',
      `Open this link to sign in to Kriegsspiel. It works once and expires in 15 minutes.\n\n${link}\n\nIf you did not ask for it, ignore this message.`,
    );
  }

  async sendNotification(to: string, subject: string, text: string): Promise<void> {
    await this.post(to, `Kriegsspiel: ${subject}`, text);
  }

  private async post(to: string, subject: string, text: string): Promise<void> {
    const res = await this.fetchFn(this.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify({ to, subject, text }),
    });
    if (!res.ok) throw new Error(`mail gateway answered ${res.status}`);
  }
}
