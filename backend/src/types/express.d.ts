import { UserResponse } from '../core/interfaces/user.interface';

declare global {
  namespace Express {
    interface Request {
      /** Set by the authenticate middleware from the verified JWT + database. */
      user?: UserResponse;
    }
  }
}

export {};
