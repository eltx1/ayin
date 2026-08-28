export const adminRoleRegistry = {
  SUPERADMIN: { rank: 100, label: "Superadmin" },
  ADMIN: { rank: 50, label: "Admin" },
} as const;

export type AdminRole = keyof typeof adminRoleRegistry;

export function isAdminRole(value: string): value is AdminRole {
  return Object.prototype.hasOwnProperty.call(adminRoleRegistry, value);
}
