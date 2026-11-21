export class WhatsAppError extends Error {
  constructor(
    message: string,
    /** false = retrying will not help (e.g. invalid number); true = network/5xx/timeout. */
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'WhatsAppError';
  }
}

export interface SendDocumentRequest {
  to: string;
  documentUrl: string;
  fileName: string;
  caption: string;
  /** Same key on every retry: the provider recognises a repeat and does not send twice. */
  idempotencyKey: string;
}

export class WhatsAppClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
  ) {}

  async sendDocument(request: SendDocumentRequest): Promise<{ messageId: string }> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': request.idempotencyKey },
        body: JSON.stringify({
          to: request.to,
          type: 'document',
          document: { link: request.documentUrl, filename: request.fileName },
          caption: request.caption,
        }),
        // Never wait forever on the provider.
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const reason = (err as Error).name === 'TimeoutError' ? `timed out after ${this.timeoutMs}ms` : (err as Error).message;
      throw new WhatsAppError(`WhatsApp request failed: ${reason}`, true);
    }

    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
      throw new WhatsAppError(`WhatsApp rejected the message (HTTP ${response.status})`, false);
    }
    if (!response.ok) {
      throw new WhatsAppError(`WhatsApp is unavailable (HTTP ${response.status})`, true);
    }
    return (await response.json()) as { messageId: string };
  }
}
