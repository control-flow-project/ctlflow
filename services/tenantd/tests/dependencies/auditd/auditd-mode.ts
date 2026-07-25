export type AuditdMode =
  | "normal"
  | "unavailable"
  | "resource-exhausted"
  | "stall"
  | "accept-then-drop"
  | "conflicting-replay"
  | "invalid-envelope"
  | "invalid-acceptance"
  | "permission-denied";
