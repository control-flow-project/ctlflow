# C#-specific integration evidence

Canonical wire behavior belongs in `services/tenantd/tests/` and already
publishes and executes the real NativeAOT process.

Add a C# test project here only for evidence that cannot apply to another
implementation, such as direct compiled-model inspection or native packaging
diagnostics. It must still use the migrated file-backed database and shipping
artifact, and it must not duplicate a canonical RPC assertion.
