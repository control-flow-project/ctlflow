namespace Crossfire.Build.Ef;

public sealed class QuerySource : ExpressionVisitor
{
    protected override Expression VisitMember(MemberExpression member)
    {
        if (member.Expression is ConstantExpression { Value: DbContext context } && typeof(IQueryable).IsAssignableFrom(member.Type))
        {
            var value = member.Member switch
            {
                PropertyInfo property => property.GetValue(context),
                FieldInfo field => field.GetValue(context),
                _ => throw new InvalidOperationException("Unsupported query source member")
            };
            return value is IQueryable query ? query.Expression : throw new InvalidOperationException("The query source is not queryable");
        }
        return base.VisitMember(member);
    }

    protected override Expression VisitMethodCall(MethodCallExpression method)
    {
        if (method.Object is ConstantExpression { Value: DbContext } && method.Method.Name == nameof(DbContext.Set))
        {
            var value = Expression.Lambda<Func<IQueryable>>(Expression.Convert(method, typeof(IQueryable))).Compile(preferInterpretation: true)();
            return value.Expression;
        }
        return base.VisitMethodCall(method);
    }
}
