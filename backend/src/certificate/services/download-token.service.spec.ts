import { DownloadTokenService } from './download-token.service';

describe('DownloadTokenService', () => {
  const service = new DownloadTokenService('unit-test-secret-0123456789', 30);
  const NOW = Date.UTC(2026, 10, 21);

  describe('create', () => {
    it('creates a token that is valid for the same certificate', () => {
      const token = service.create('PSM-2026-ABCDEFGH', NOW);

      expect(service.isValid('PSM-2026-ABCDEFGH', token, NOW)).toBe(true);
    });
  });

  describe('isValid', () => {
    it('rejects a token issued for another certificate', () => {
      const token = service.create('PSM-2026-ABCDEFGH', NOW);

      expect(service.isValid('PSM-2026-ZZZZZZZZ', token, NOW)).toBe(false);
    });

    it('rejects a token after it expires', () => {
      const token = service.create('PSM-2026-ABCDEFGH', NOW);
      const thirtyOneDaysLater = NOW + 31 * 24 * 3600 * 1000;

      expect(service.isValid('PSM-2026-ABCDEFGH', token, thirtyOneDaysLater)).toBe(false);
    });

    it('rejects a token whose expiry was pushed forward by hand', () => {
      const [expiresAt, signature] = service.create('PSM-2026-ABCDEFGH', NOW).split('.');
      const tampered = `${Number(expiresAt) + 365 * 24 * 3600}.${signature}`;

      expect(service.isValid('PSM-2026-ABCDEFGH', tampered, NOW)).toBe(false);
    });

    it('rejects a token signed with a different secret', () => {
      const other = new DownloadTokenService('another-secret-0123456789');
      const token = other.create('PSM-2026-ABCDEFGH', NOW);

      expect(service.isValid('PSM-2026-ABCDEFGH', token, NOW)).toBe(false);
    });

    it.each(['', 'abc', '123.', '.sig', 'notanumber.sig', '9999999999.short'])(
      'rejects the malformed token "%s"',
      (token) => {
        expect(service.isValid('PSM-2026-ABCDEFGH', token, NOW)).toBe(false);
      },
    );
  });
});
