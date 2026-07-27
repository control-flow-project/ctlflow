using System.Net;
using CtlFlow.Audit.Auditd.Db.Providers;
using CtlFlow.Audit.Auditd.Service.Security;
using CtlFlow.Audit.Auditd.Service.Telemetry;

namespace CtlFlow.Audit.Auditd.Service.Configuration;

internal sealed record ServiceSettings(
    IPAddress GrpcAddress,
    int GrpcPort,
    IPAddress ProbeAddress,
    int ProbePort,
    TlsSettings Tls,
    DatabaseConfiguration Database,
    WorkloadTokenSettings WorkloadTokens,
    AuditSourceMappings Sources,
    TelemetrySettings Telemetry);
