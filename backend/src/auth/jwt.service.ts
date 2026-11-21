import jwt from 'jsonwebtoken';

export class JwtService {
  constructor(private readonly secret: string) {}

  sign(userId: number): string {
    return jwt.sign({ sub: String(userId) }, this.secret, { algorithm: 'HS256', expiresIn: '8h' });
  }

  /** Returns the user id, or null for a missing/expired/tampered token. */
  verify(token: string): number | null {
    try {
      // Pin the algorithm: a token signed with "none" or another algorithm is rejected.
      const payload = jwt.verify(token, this.secret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
      const userId = Number(payload.sub);
      return Number.isInteger(userId) ? userId : null;
    } catch {
      return null;
    }
  }
}
