using CtlFlow.Identity.Identityd.Db.Providers;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Identity.Identityd.Db.Schema;

public static partial class Schemas
{
    public static async Task<SchemaCompatibility> VerifySchema(
        IdentityDatabase identityDatabase,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var activity = IdentityDbTelemetry.StartOperation(
            "verify_schema");
        var ledger = await VerifyMigrationLedger(
            identityDatabase,
            cancellation);
        if (ledger != SchemaCompatibility.Compatible)
        {
            return ledger;
        }

        await using var database =
            await identityDatabase.Contexts.CreateDbContextAsync(cancellation);
        var queryCancellation = cancellation;
        await database.Accounts.AsNoTracking()
            .Select(value => new
            {
                Id = EF.Property<string>(value, "_id"),
                value.Kind,
                value.Enabled,
                value.Revision
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.VirtualPrincipals.AsNoTracking()
            .Select(value => new
            {
                Id = EF.Property<string>(value, "_id"),
                Subject = EF.Property<string>(
                    value,
                    "_subjectAccountId"),
                value.Enabled,
                value.Revision,
                Tenant = EF.Property<string>(
                    value,
                    "_tenantFenceId"),
                Workspace = EF.Property<string?>(
                    value,
                    "_workspaceFenceId")
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.TenantMemberships.AsNoTracking()
            .Select(value => new
            {
                Account = EF.Property<string>(value, "_accountId"),
                Tenant = EF.Property<string>(value, "_tenantId"),
                value.Revision
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.WorkspaceMemberships.AsNoTracking()
            .Select(value => new
            {
                Account = EF.Property<string>(value, "_accountId"),
                Tenant = EF.Property<string>(value, "_tenantId"),
                Workspace = EF.Property<string>(value, "_workspaceId"),
                value.Revision
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.Groups.AsNoTracking()
            .Select(value => new
            {
                Id = EF.Property<string>(value, "_id"),
                Tenant = EF.Property<string>(value, "_tenantId"),
                Workspace = EF.Property<string?>(
                    value,
                    "_workspaceId")
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.AccountGroupMemberships.AsNoTracking()
            .Select(value => new
            {
                Account = EF.Property<string>(value, "_accountId"),
                Group = EF.Property<string>(value, "_groupId")
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.VirtualPrincipalGroupMemberships.AsNoTracking()
            .Select(value => new
            {
                Principal = EF.Property<string>(
                    value,
                    "_principalId"),
                Group = EF.Property<string>(value, "_groupId")
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.InvocationVerificationKeys.AsNoTracking()
            .Select(value => new
            {
                Id = EF.Property<string>(value, "_id"),
                value.Algorithm,
                Modulus = EF.Property<string>(value, "_modulus"),
                Exponent = EF.Property<string>(value, "_exponent"),
                value.State,
                value.Revision
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.LoginProviders.AsNoTracking()
            .Select(value => new
            {
                Tenant = EF.Property<string>(value, "_tenantId"),
                Provider = EF.Property<string>(value, "_providerId"),
                DisplayName = EF.Property<string>(value, "_displayName"),
                Configuration = EF.Property<string>(
                    value,
                    "_configurationId"),
                ConfigurationVersion = EF.Property<string>(
                    value,
                    "_configurationVersionId"),
                Secret = EF.Property<string>(value, "_secretId"),
                SecretVersion = EF.Property<string>(
                    value,
                    "_secretVersionId"),
                value.State,
                value.Revision
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.WorkspaceLoginProviderAdmissions.AsNoTracking()
            .Select(value => new
            {
                Tenant = EF.Property<string>(value, "_tenantId"),
                Workspace = EF.Property<string>(value, "_workspaceId"),
                Provider = EF.Property<string>(value, "_providerId")
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.ExternalIdentityLinks.AsNoTracking()
            .Select(value => new
            {
                Tenant = EF.Property<string>(value, "_tenantId"),
                Provider = EF.Property<string>(value, "_providerId"),
                Subject = EF.Property<string>(value, "_providerSubject"),
                Account = EF.Property<string>(value, "_accountId"),
                value.Revision
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        await database.Sessions.AsNoTracking()
            .Select(value => new
            {
                Id = EF.Property<string>(value, "_id"),
                Credential = EF.Property<string>(
                    value,
                    "_credentialDigest"),
                Account = EF.Property<string>(value, "_accountId"),
                Tenant = EF.Property<string>(value, "_tenantId"),
                value.CreatedAt,
                value.ExpiresAt,
                value.RevokedAt,
                value.Revision
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        return SchemaCompatibility.Compatible;
    }
}
