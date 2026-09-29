import type { Permission } from '@crossfire/domain/authorization/types';
import type { Tables } from '../../schema/tables.js';
export function mapPermission(row: Tables['permission']): Permission {
  return {
    code: row.code,
    grantScope: row.grant_scope,
    description: row.description,
  };
}
