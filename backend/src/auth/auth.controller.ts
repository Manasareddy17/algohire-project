import { Router } from 'express';
import { z } from 'zod';
import { UnauthorizedException } from '../core/exceptions';
import { UserDatabaseService } from '../database';
import { parseBody } from '../middlewares/validate';
import { authenticate } from './auth.middleware';
import { JwtService } from './jwt.service';

const loginSchema = z.object({ username: z.string().trim().toLowerCase().min(1).max(50) });

/**
 * Demo login: pick one of the seeded people, no password. The brief asks reviewers to
 * "switch between these people and try every flow straight away", so it exists — but only
 * when DEMO_LOGIN_ENABLED=true (docker-compose demo). When it is false (the default, and
 * production) these routes are not registered at all, so they return 404.
 *
 * In production a real sign-in (OTP / state SSO) issues the same JWT. Everything after
 * login — token check, role, district and stage rules — is unchanged.
 */
export function createAuthRouter(jwtService: JwtService, userDatabaseService: UserDatabaseService, demoLoginEnabled: boolean) {
  const router = Router();

  if (demoLoginEnabled) {
    router.get('/demo-users', async (_req, res) => {
      res.json(await userDatabaseService.fetchDemoUsers());
    });

    router.post('/login', async (req, res) => {
      const { username } = parseBody(loginSchema, req.body);
      const user = await userDatabaseService.fetchUserByUsername(username);
      if (!user) throw new UnauthorizedException('Unknown user');
      res.json({ token: jwtService.sign(user.id), user });
    });
  }

  router.get('/me', authenticate(jwtService, userDatabaseService), (req, res) => {
    res.json(req.user);
  });

  return router;
}
