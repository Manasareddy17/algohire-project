import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signed download links: only someone who received the WhatsApp message (which contains
 * the link) can download the PDF. The token is HMAC(certificateNo + expiry) with a server
 * secret, so it cannot be forged or reused for another certificate.
 */
export class DownloadTokenService {
  constructor(
    private readonly secret: string,
    private readonly validForDays = 30,
  ) {}

  create(certificateNo: string, now = Date.now()): string {
    const expiresAt = Math.floor(now / 1000) + this.validForDays * 24 * 3600;
    return `${expiresAt}.${this.sign(certificateNo, expiresAt)}`;
  }

  isValid(certificateNo: string, token: string, now = Date.now()): boolean {
    const [expiresAtText, signature] = token.split('.');
    const expiresAt = Number(expiresAtText);
    if (!signature || !Number.isInteger(expiresAt) || expiresAt < now / 1000) return false;

    const expected = Buffer.from(this.sign(certificateNo, expiresAt));
    const given = Buffer.from(signature);
    // timingSafeEqual: comparing takes the same time whether 1 or 20 characters match.
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  private sign(certificateNo: string, expiresAt: number): string {
    return createHmac('sha256', this.secret).update(`${certificateNo}.${expiresAt}`).digest('base64url');
  }
}
