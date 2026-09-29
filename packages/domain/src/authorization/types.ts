export type Permission = {
  code: string;
  grantScope: 'role' | 'agent_room';
  description: string;
};

export type Role = {
  code: 'member' | 'administrator' | 'agent';
  principalKind: 'human' | 'agent';
  label: string;
};

export type RolePermission = {
  roleCode: string;
  permissionCode: string;
  grantScope: 'role';
};

export type PrincipalRole = {
  principalId: string;
  principalKind: 'human' | 'agent';
  roleCode: 'member' | 'administrator' | 'agent';
  assignedByMemberId: string | null;
  assignedAt: number;
};
