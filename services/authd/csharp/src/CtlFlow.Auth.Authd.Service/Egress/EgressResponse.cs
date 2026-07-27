namespace CtlFlow.Auth.Authd.Service.Egress;

internal sealed record EgressResponse(
    string? ContentType,
    byte[] Body);
