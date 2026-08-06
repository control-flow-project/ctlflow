namespace CtlFlow.Policy.Policyd.Service.Configuration;

// The Execd dependency Policyd consults to confirm a product-operation binding.
// Product authority is resolved at decision time and never stored by Policyd.
internal sealed record ExecutionSettings(
    PrivateGrpcSettings Endpoint,
    TimeSpan CallTimeout);
