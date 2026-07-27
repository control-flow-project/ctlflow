namespace CtlFlow.Audit.Auditd.Domain.Events;

public sealed class AuditContentConflictException : Exception;

public sealed class AuditCursorExhaustedException : Exception;

public sealed class AuditPermissionException : Exception;

public sealed class AuditBatchLimitException : Exception;
