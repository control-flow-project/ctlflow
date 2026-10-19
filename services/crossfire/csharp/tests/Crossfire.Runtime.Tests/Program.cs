using System.Runtime.CompilerServices;
using Crossfire.Runtime.Tests;
using System.Runtime.Versioning;

[assembly: SupportedOSPlatform("linux")]

if (Crossfire.AdapterRuntime.NativeGuard.Requested(args)) { Environment.ExitCode = await Crossfire.AdapterRuntime.NativeGuard.Run(args); return; }
if (args.Length != 0) throw new ArgumentException("Runtime acceptance takes no optional suite flags");
StatisticsAcceptance.Verify();
await ProtocolAcceptance.Verify();
await SignalAcceptance.Verify();
ConfigurationAcceptance.Verify();
NativeValuesAcceptance.Verify();
ProviderDiagnosticsAcceptance.Verify();
await ProcessAcceptance.Verify();
await ModelAcceptance.Verify();
HistoryAcceptance.Verify();
await CodexAcceptance.Verify();
await PiAcceptance.Verify();
await PiProtocolAcceptance.Verify();
await OwnedPiAcceptance.Verify();
await DeliveryAcceptance.Verify();
await ListenerReportingAcceptance.Verify();
await FleetConnectionAcceptance.Verify();
await ChatPublicationAcceptance.Verify();
Console.WriteLine("{\"status\":\"passed\",\"scope\":\"implemented runtime transport\",\"assertions\":" + Checks.Passed
    + ",\"dynamicCode\":" + (RuntimeFeature.IsDynamicCodeSupported ? "true" : "false") + "}");
