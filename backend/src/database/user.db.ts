import { UserResponse } from '../core/interfaces/user.interface';
import { EntityManager, prisma } from './prisma.service';

export class UserDatabaseService {
  constructor(private readonly db: EntityManager = prisma) {}

  fetchUserById(id: number): Promise<UserResponse | null> {
    return this.db.user.findUnique({
      where: { id },
      select: { id: true, username: true, name: true, role: true, districtId: true, centreId: true },
    });
  }

  fetchUserByUsername(username: string): Promise<UserResponse | null> {
    return this.db.user.findUnique({
      where: { username },
      select: { id: true, username: true, name: true, role: true, districtId: true, centreId: true },
    });
  }

  fetchDemoUsers() {
    return this.db.user.findMany({
      orderBy: { id: 'asc' },
      select: {
        username: true,
        name: true,
        role: true,
        district: { select: { name: true } },
        centre: { select: { name: true } },
      },
    });
  }
}
