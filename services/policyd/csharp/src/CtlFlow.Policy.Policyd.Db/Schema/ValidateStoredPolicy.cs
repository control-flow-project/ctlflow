using CtlFlow.Policy.Policyd.Domain.Catalog;
using CtlFlow.Policy.Policyd.Domain.Operations;
using CtlFlow.Policy.Policyd.Db.Providers;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Policy.Policyd.Db.Schema;

public static partial class Schemas
{
    private const int MaximumRoles = 10_000;
    private const int MaximumRoleBindings = 100_000;
    private const int MaximumAccessGrants = 100_000;
    private const int MaximumRoleRules = 2_560_000;
    private const int MaximumCatalogOperations = 22;

    private static async Task<bool> ValidateStoredPolicy(
        PolicyDatabase policyDatabase,
        CancellationToken cancellation)
    {
        await using var database =
            await policyDatabase.Contexts.CreateDbContextAsync(cancellation);
        var queryCancellation = cancellation;
        var roleLimit = MaximumRoles + 1;
        var roleRuleLimit = MaximumRoleRules;
        var roleBindingLimit = MaximumRoleBindings;
        var accessGrantLimit = MaximumAccessGrants;
        var operationLimit = MaximumCatalogOperations + 1;
        var roleIds = await database.Roles
            .AsNoTracking()
            .OrderBy(value => EF.Property<string>(value, "_id"))
            .Select(value => EF.Property<string>(value, "_id"))
            .Take(roleLimit)
            .ToListAsync(queryCancellation);
        if (roleIds.Count > MaximumRoles)
        {
            return false;
        }

        var tooManyRoleRules = await database.RoleRules
            .AsNoTracking()
            .OrderBy(value => EF.Property<string>(value, "_roleId"))
            .ThenBy(value => EF.Property<string>(value, "_operation"))
            .ThenBy(value => EF.Property<string>(value, "_basePath"))
            .ThenBy(value => EF.Property<int>(value, "_matchKind"))
            .Skip(roleRuleLimit)
            .AnyAsync(queryCancellation);
        var tooManyRoleBindings = await database.RoleBindings
            .AsNoTracking()
            .OrderBy(value => EF.Property<string>(value, "_roleId"))
            .ThenBy(value => EF.Property<int>(value, "_subjectKind"))
            .ThenBy(value => EF.Property<string>(value, "_subjectId"))
            .Skip(roleBindingLimit)
            .AnyAsync(queryCancellation);
        var tooManyAccessGrants = await database.AccessGrants
            .AsNoTracking()
            .OrderBy(value => EF.Property<long>(value, "_id"))
            .Skip(accessGrantLimit)
            .AnyAsync(queryCancellation);
        if (tooManyRoleRules
            || tooManyRoleBindings
            || tooManyAccessGrants)
        {
            return false;
        }

        var ruleRoleIds = await database.RoleRules
            .AsNoTracking()
            .Select(value => EF.Property<string>(value, "_roleId"))
            .Distinct()
            .OrderBy(value => value)
            .Take(roleLimit)
            .ToListAsync(queryCancellation);
        var rolesWithRules = ruleRoleIds.ToHashSet(StringComparer.Ordinal);
        if (roleIds.Any(roleId => !rolesWithRules.Contains(roleId)))
        {
            return false;
        }

        var roleOperations = await database.RoleRules
            .AsNoTracking()
            .Select(value => EF.Property<string>(value, "_operation"))
            .Distinct()
            .OrderBy(value => value)
            .Take(operationLimit)
            .ToListAsync(queryCancellation);
        var grantOperations = await database.AccessGrants
            .AsNoTracking()
            .Select(value => EF.Property<string>(value, "_operation"))
            .Distinct()
            .OrderBy(value => value)
            .Take(operationLimit)
            .ToListAsync(queryCancellation);
        var storedOperations = roleOperations
            .Concat(grantOperations)
            .Distinct(StringComparer.Ordinal)
            .ToArray();
        return storedOperations.Length <= MaximumCatalogOperations
            && storedOperations
            .All(operation =>
                OperationCatalog.FindOperationOwner(
                    OperationToken.FromStorage(operation)) is not null);
    }
}
