import { CERTIFICATE_NO_PATTERN, generateCertificateNo } from './certificate-number.service';

describe('generateCertificateNo', () => {
  it('uses the PSM-<year>-<8 chars> format with the issue year', () => {
    const certificateNo = generateCertificateNo(new Date('2027-03-01T00:00:00Z'));

    expect(certificateNo).toMatch(/^PSM-2027-[A-Z2-9]{8}$/);
    expect(certificateNo).toMatch(CERTIFICATE_NO_PATTERN);
  });

  it('never uses characters that are easy to misread (0, O, 1, I, L)', () => {
    const suffixes = Array.from({ length: 500 }, () => generateCertificateNo().slice(9)).join('');

    expect(suffixes).not.toMatch(/[01OIL]/);
  });

  it('produces different numbers on every call', () => {
    const numbers = new Set(Array.from({ length: 5000 }, () => generateCertificateNo()));

    expect(numbers.size).toBe(5000);
  });
});
