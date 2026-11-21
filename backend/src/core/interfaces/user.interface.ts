import { Role } from '@prisma/client';

/** The authenticated user. Always loaded from the database, never taken from the request body. */
export interface UserResponse {
  id: number;
  username: string;
  name: string;
  role: Role;
  districtId: number | null;
  centreId: number | null;
}
