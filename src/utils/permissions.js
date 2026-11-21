export const ROLES = ['super_admin', 'branch_manager', 'dispatcher', 'accountant', 'driver'];
export const ROLE_LABELS = {
  super_admin: 'Super Admin', branch_manager: 'Branch Manager', dispatcher: 'Dispatcher', accountant: 'Accountant', driver: 'Driver',
};

const GRANTS = {
  super_admin: ['*'],
  branch_manager: [
    'dashboard:read', 'vehicles:read', 'vehicles:write', 'vehicles:delete', 'drivers:read', 'drivers:write', 'drivers:delete',
    'trips:read', 'trips:write', 'trips:delete', 'trips:payment', 'users:read', 'users:write', 'audit:read', 'tracking:read', 'invoices:read',
    'customers:read', 'customers:write', 'customers:delete', 'rates:read', 'maintenance:read', 'maintenance:write', 'maintenance:delete', 'alerts:read', 'alerts:run',
    'expenses:read', 'expenses:add', 'expenses:write', 'expenses:delete', 'reports:export',
  ],
  dispatcher: ['dashboard:read', 'vehicles:read', 'vehicles:write', 'drivers:read', 'drivers:write', 'trips:read', 'trips:write', 'tracking:read',
    'customers:read', 'customers:write', 'rates:read', 'maintenance:read', 'maintenance:write', 'alerts:read', 'expenses:read', 'reports:export'],
  accountant: ['dashboard:read', 'vehicles:read', 'drivers:read', 'trips:read', 'trips:payment', 'invoices:read',
    'customers:read', 'rates:read', 'maintenance:read', 'alerts:read',
    'expenses:read', 'expenses:add', 'expenses:write', 'reports:export'],
  driver: ['trips:read', 'trips:status', 'trips:location', 'expenses:read', 'expenses:add'],
};

export const permissionsFor = (role) => GRANTS[role] || [];
export const can = (user, perm) => {
  const g = permissionsFor(user?.role);
  return g.includes('*') || g.includes(perm);
};
// Roles an actor is allowed to hand out when creating/editing users
export const assignableRoles = (actor) => (actor.role === 'super_admin' ? ROLES : ['dispatcher', 'accountant', 'driver']);
