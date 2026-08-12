namespace CtlFlow.Auth.Authd.Service.Identity;

internal sealed class LoginProviderRejectedException(
    Exception? innerException = null)
    : Exception("Login provider selection was rejected", innerException);
