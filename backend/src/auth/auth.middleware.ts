import { Role } from '@prisma/client';
import { NextFunction, Request, Response } from 'express';
import { ForbiddenException, UnauthorizedException } from '../core/exceptions';
import { UserDatabaseService } from '../database';
import { JwtService } from './jwt.service';

/**
 * Who is calling? Read ONLY from the signed token, then load the user (role, district, centre)
 * fresh from the database. Nothing in the request body can change who you are.
 */
export function authenticate(jwtService: JwtService, userDatabaseService: UserDatabaseService) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? '';
    // EventSource (live updates) cannot send headers, so the SSE route may pass ?token=.
    const token = header.startsWith('Bearer ') ? header.slice(7) : (req.query.token as string | undefined);
    const userId = token ? jwtService.verify(token) : null;
    if (!userId) throw new UnauthorizedException('Please log in');

    const user = await userDatabaseService.fetchUserById(userId);
    if (!user) throw new UnauthorizedException('Please log in');

    req.user = user;
    next();
  };
}

/** Route-level role check. Handlers still check the finer rules (own centre, own district, stage). */
export function requireRoles(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw new ForbiddenException('You do not have access to this action');
    }
    next();
  };
}
