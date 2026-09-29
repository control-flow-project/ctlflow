export const authorizationSchema = `
CREATE TABLE permission (
  code TEXT NOT NULL,
  grant_scope TEXT NOT NULL,
  description TEXT NOT NULL,
  PRIMARY KEY (code),
  UNIQUE(code, grant_scope),
  CHECK(grant_scope IN ('role','agent_room'))
) STRICT;


CREATE TABLE role (
  code TEXT NOT NULL,
  principal_kind TEXT NOT NULL,
  label TEXT NOT NULL,
  PRIMARY KEY (code),
  UNIQUE(code, principal_kind),
  CHECK(principal_kind IN ('human','agent'))
) STRICT;


CREATE TABLE role_permission (
  role_code TEXT NOT NULL,
  permission_code TEXT NOT NULL,
  grant_scope TEXT NOT NULL,
  PRIMARY KEY (role_code, permission_code),
  CHECK(grant_scope = 'role'),
  FOREIGN KEY(role_code) REFERENCES role(code),
  FOREIGN KEY(permission_code, grant_scope) REFERENCES permission(code, grant_scope)
) STRICT;
CREATE INDEX ix_role_permission_permission ON role_permission(permission_code, role_code);

CREATE TABLE principal_role (
  principal_id TEXT NOT NULL,
  principal_kind TEXT NOT NULL,
  role_code TEXT NOT NULL,
  assigned_by_member_id TEXT,
  assigned_at INTEGER NOT NULL,
  PRIMARY KEY (principal_id),
  FOREIGN KEY(principal_id, principal_kind) REFERENCES principal(id, kind),
  FOREIGN KEY(role_code, principal_kind) REFERENCES role(code, principal_kind),
  FOREIGN KEY(assigned_by_member_id) REFERENCES member(principal_id)
) STRICT;
CREATE INDEX ix_principal_role_role ON principal_role(role_code, principal_id);
`;
