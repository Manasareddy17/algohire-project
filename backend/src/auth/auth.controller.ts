import { Router } from 'express';
import { z } from 'zod';
import { UnauthorizedException } from '../core/exceptions';
import { UserDatabaseService } from '../database';
import { parseBody } from '../middlewares/validate';
import { authenticate } from './auth.middleware';
import { JwtService } from './jwt.service';

const loginSchema = z.object({ username: z.string().trim().toLowerCase().min(1).max(50) });

/**
 * Demo login: pick one of the seeded people. The brief asks reviewers to "switch between these
 * people", so there is no password; in production this route is replaced by SSO / OTP and
 * everything after it (JWT, role checks) stays the same.
 */
export function createAuthRouter(jwtService: JwtService, userDatabaseService: UserDatabaseService) {
  const router = Router();

  router.get('/demo-users', async (_req, res) => {
    res.json(await userDatabaseService.fetchDemoUsers());
  });

  router.post('/login', async (req, res) => {
    const { username } = parseBody(loginSchema, req.body);
    const user = await userDatabaseService.fetchUserByUsername(username);
    if (!user) throw new UnauthorizedException('Unknown user');
    res.json({ token: jwtService.sign(user.id), user });
  });

  router.get('/me', authenticate(jwtService, userDatabaseService), (req, res) => {
    res.json(req.user);
  });

  return router;
}
