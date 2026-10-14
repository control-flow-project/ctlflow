namespace Crossfire.Kernel;

public sealed record Failure(string Code, string Message, IReadOnlyDictionary<string, string>? FieldErrors = null);

public readonly struct Result<T>
{
    private readonly T? value;
    private readonly Failure? error;

    private Result(bool succeeded, T? result, Failure? failure)
        => (IsSuccess, value, error) = (succeeded, result, failure);

    public bool IsSuccess { get; }
    public T Value => IsSuccess ? value! : throw new InvalidOperationException("Expected a successful result");
    public Failure Error => !IsSuccess && error is not null ? error : throw new InvalidOperationException("Expected a failed result");
    public static Result<T> Success(T value) => new(true, value, null);
    public static Result<T> Fail(string code, string message) => new(false, default, new(code, message));
    public static Result<T> Fail(Failure error) => new(false, default, error);
    public Result<TNext> Map<TNext>(Func<T, TNext> transform)
        => IsSuccess ? Result<TNext>.Success(transform(Value)) : Result<TNext>.Fail(Error);
    public Result<TNext> Bind<TNext>(Func<T, Result<TNext>> transform)
        => IsSuccess ? transform(Value) : Result<TNext>.Fail(Error);
}

public readonly record struct Unit;

public static class Results
{
    public static Result<Unit> Done() => Result<Unit>.Success(default);
    public static Result<T> Fail<T>(string code, string message) => Result<T>.Fail(code, message);
}
