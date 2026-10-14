using System.Diagnostics.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Editing;
using Microsoft.EntityFrameworkCore.Query.Internal;
using Microsoft.EntityFrameworkCore.Query.SqlExpressions;

namespace Crossfire.Build.Ef;

[Experimental("EF9100")]
[SuppressMessage("Usage", "EF1001", Justification = "Version-pinned build-time expression emitter; native sealed-entity migration tests verify its generated queries.")]
public sealed class NativeModelTranslator(SyntaxGenerator generator) : RuntimeModelLinqToCSharpSyntaxTranslator(generator)
{
    protected override ExpressionSyntax GenerateUnknownValue(object value)
        => base.GenerateUnknownValue(value is Expression expression ? new NativeSqlQuoting().Visit(expression) : value);

    protected override Expression VisitConditional(ConditionalExpression conditional)
    {
        if (conditional.Test is TypeBinaryExpression { NodeType: ExpressionType.TypeIs, Expression: ParameterExpression parameter } test
            && parameter.Type.IsSealed && !test.TypeOperand.IsAssignableFrom(parameter.Type))
        {
            if (conditional.IfFalse is DefaultExpression { Type: var type } && type == typeof(void))
            {
                Result = SyntaxFactory.EmptyStatement();
                return conditional;
            }
            return Visit(conditional.IfFalse);
        }
        return base.VisitConditional(conditional);
    }

    private sealed class NativeSqlQuoting : ExpressionVisitor
    {
        protected override Expression VisitExtension(Expression expression)
            => expression is SqlConstantExpression constant ? new NativeSqlConstant(constant) : base.VisitExtension(expression);
    }

    private sealed class NativeSqlConstant(SqlConstantExpression source) : SqlConstantExpression(source.Value, source.Type, source.IsSensitive, source.TypeMapping)
    {
        private static readonly ConstructorInfo Constructor = typeof(SqlConstantExpression).GetConstructor([typeof(object), typeof(Type), typeof(bool), typeof(RelationalTypeMapping)])!;

        public override Expression Quote()
            => Expression.New(Constructor, Expression.Constant(Value, typeof(object)), Expression.Constant(Type), Expression.Constant(IsSensitive),
                RelationalExpressionQuotingUtilities.QuoteTypeMapping(TypeMapping));
    }
}
