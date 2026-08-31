export const adminRoleRegistry = {
  SUPERADMIN: { rank: 100, label: "Superadmin" },
  ADMIN: { rank: 80, label: "Administrator" },
  OPERATIONS: { rank: 60, label: "Operations" },
  CONTENT_MODERATOR: { rank: 50, label: "Content moderator" },
  AD_MANAGER: { rank: 50, label: "Advertising manager" },
  FINANCE_MANAGER: { rank: 50, label: "Finance manager" },
} as const;

export type AdminRole = keyof typeof adminRoleRegistry;

export function isAdminRole(value: string): value is AdminRole {
  return Object.prototype.hasOwnProperty.call(adminRoleRegistry, value);
}

export function isPrivilegedAdminRole(role: AdminRole): boolean {
  return role === "SUPERADMIN" || role === "ADMIN";
}

export const assignableAdminRoles = Object.keys(adminRoleRegistry) as AdminRole[];
