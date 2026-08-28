import { Inject, Injectable } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { type AdminRole, isAdminRole } from "./admin.roles.js";

@Injectable()
export class AdminAuthorizationService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async getRoles(accountId: string): Promise<AdminRole[]> {
    const assignments = await this.database.client.adminRoleAssignment.findMany({
      where: { accountId },
      select: { role: true },
    });
    return assignments.map(({ role }) => role).filter(isAdminRole);
  }

  async hasRole(accountId: string, role: AdminRole): Promise<boolean> {
    return (await this.getRoles(accountId)).includes(role);
  }
}
