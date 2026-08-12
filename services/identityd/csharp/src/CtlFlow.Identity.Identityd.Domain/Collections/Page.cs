namespace CtlFlow.Identity.Identityd.Domain.Collections;

public sealed record Page<T>(
    IReadOnlyList<T> Items,
    string? NextAfter);
