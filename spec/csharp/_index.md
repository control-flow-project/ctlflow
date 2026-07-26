---
title: C# Implementation
weight: 31
---

This page defines the C# realization of a CtlFlow service. It applies only inside a service's
`csharp/` directory. It does not define the internal architecture for another language
implementation; those implementations use patterns natural to their own languages while
meeting the shared contract in [Implementation](../implementation/).

The C# design is deliberately small and functional. A service has three production projects:

- **Domain** owns service concepts, invariants, decisions, and purpose-named results.
- **Db** owns the concrete Entity Framework context, mappings, provider configuration, and fixed
  persistence operations.
- **Service** owns process startup, gRPC translation, authentication integration, and lifecycle.

There is no Application project, generic repository layer, persistence port layer, dependency bag,
or duplicate persistence model. Add a boundary only when a concrete requirement cannot be expressed
cleanly by these three projects.

## Project structure

The shared API, Knex migrations, and canonical tests remain outside `csharp/`; C# consumes them and
does not copy or replace them. The following generic Customer service uses proposed filenames:

```text
services/examples/customerd/
  api/proto/v1/customerd.proto
  knexfile.ts
  migrations/0001_create_customers.ts
  migrations/0002_create_orders.ts
  tests/integration/get-customer-summary.test.ts
  csharp/
    Example.Customers.slnx
    Directory.Build.props
    Containerfile
    src/
      Example.Customers.Domain/
        Example.Customers.Domain.csproj
        Customers/
          Customer.cs
          CustomerId.cs
          CustomerName.cs
          CustomerStanding.cs
          CustomerSummary.cs
          GetCustomerSummaryResult.cs
          CalculateCustomerStanding.cs
        Amounts/
          Money.cs
        Orders/
          Order.cs
          OrderId.cs

      Example.Customers.Db/
        Example.Customers.Db.csproj
        SalesDbContext.cs
        Customers/
          ConfigureCustomer.cs
          QueryCustomerSummary.cs
        Orders/
          ConfigureOrder.cs
        Providers/
          DatabaseProvider.cs
          CreateDbContextFactory.cs
        Sqlite/
          ConfigureSqlite.cs
      Example.Customers.Service/
        Example.Customers.Service.csproj
        Program.cs
        Grpc/
          CustomerGrpcService.cs
          Customers/
            GetCustomerSummary.cs
            ParseCustomerId.cs
            CreateCustomerSummaryResponse.cs
    tests/
      Example.Customers.NativeTests/
        Example.Customers.NativeTests.csproj
        PublishAndStart.cs
```

Only implemented providers and necessary implementation-local tests are present. The example
therefore contains only SQLite. A future PostgreSQL implementation adds its provider package,
configuration, and any genuinely provider-specific operations without changing Domain, Service,
the wire contract, or common Db operations. Empty or dormant provider directories are not checked
in.

## Dependencies

| Project | May reference | Must not own |
| --- | --- | --- |
| Domain | BCL | Wire types, hosting, Entity Framework, provider selection, schema migrations |
| Db | Domain, Entity Framework, selected database providers | Business decisions, gRPC translation, schema migrations |
| Service | Domain, Db, generated gRPC bindings, hosting libraries | Domain rules, provider-specific queries, schema migrations |

Db persistence operations are semantic functions rather than repositories. Each operation creates
and disposes a concrete context locally, executes one fixed Entity Framework query or mutation, and
returns a typed Domain result. This placement is required so Entity Framework's NativeAOT
precompiler can see the complete query root and expression; passing `DbSet<T>` or `IQueryable<T>`
into another project creates a runtime-composed query and is forbidden.

```text
Service -> Domain
Service -> Db -> Domain
```

## Functional source rules

C# does not have free module functions, so partial static classes act only as namespaces for
related functions. Use a concise domain noun for the module and a semantic verb phrase for each
function. The complete Domain example below defines `public static partial class Customers`; call
sites import that module with `using static` and call the function directly:

```csharp
using static Example.Customers.Db.Customers.Customers;

var result = await QueryCustomerSummary(
    dbContexts,
    customerId,
    cancellation);
```

Use names such as `QueryCustomerSummary`, `CalculateCustomerStanding`, `ParseCustomerId`, and
`CreateCustomerSummaryResponse`. Do not introduce ceremony such as `Execute`, `Run`, `Handle`,
`CustomerFunctions`, `GetSummaryUseCase`, or `CustomerRepository`.

CtlFlow-owned operation functions are awaitable by default and do not use an `Async` suffix.
Functions that can complete synchronously return a completed `ValueTask<T>` without allocating an
async state machine. Naturally asynchronous I/O uses `Task<T>`. Framework-owned method names such
as `ToListAsync` keep their framework spelling. Required synchronous framework callbacks, including
Entity Framework model configuration, are explicit exceptions.

Nouns are directories and public operations are verb-named files. Each hand-authored file normally
owns one public operation. Private helpers stay beside the operation that owns them until another
operation genuinely shares them.

Classes remain appropriate for Domain entities and value types, the Entity Framework `DbContext`,
generated protobuf types, the concrete gRPC service subclass, and typed startup configuration.

## Model families

The service normally has only two principal model families:

1. **Generated wire models** represent protobuf requests and responses at the Service boundary.
2. **Domain models** represent business state and are mapped directly by Entity Framework.

Do not create parallel `Customer`, `CustomerEntity`, and `CustomerRow` types for the same stored
record. The Domain entity is the Entity Framework entity unless a reviewed persistence requirement
makes that impossible.

Every Entity Framework query uses an explicit closed scalar projection. A query never asks Entity
Framework to materialize a mapped Domain entity directly. The projection names every stored value
needed by that operation, including identifiers, relationships, state, and the original concurrency
revision. A projection used only by one operation is an anonymous local value. A result with meaning
outside that expression is a purpose-named Domain result.

Neither form is a third persistence model:

```csharp
// Domain/Customers/CustomerSummary.cs
namespace Example.Customers.Domain.Customers;

public sealed record CustomerSummary(
    CustomerId CustomerId,
    CustomerName CustomerName,
    int OrderCount,
    Money TotalOrdered,
    CustomerStanding Standing);
```

Separate persistence-only records are an escape hatch for concrete needs such as idempotency
records, encrypted storage envelopes, or provider-specific materialized views. Their file and name
must state that storage purpose. They never leak into the wire contract.

## Domain

Domain owns:

- validated identifiers, names, amounts, states, and other service concepts;
- entities and relationships;
- invariant checks and state transitions;
- purpose-named query results; and
- closed success and failure results used by Service translation.

Domain does not know protobuf, gRPC, HTTP, process environment, Kubernetes, database connection
strings, or a concrete database provider.

### Domain entities

The entity used by business logic is also mapped by Entity Framework:

```csharp
// Domain/Customers/Customer.cs
public class Customer
{
    private Customer() { }
    public Customer(CustomerId id, CustomerName name) => (Id, Name) = (id, name);
    public CustomerId Id { get; private set; }
    public CustomerName Name { get; private set; }
    public long Revision { get; private set; } = 1;
}
```

```csharp
// Domain/Orders/Order.cs
public class Order
{
    private Order() { }
    public Order(OrderId id, CustomerId customerId, Money total)
        => (Id, CustomerId, Total) = (id, customerId, total);
    public OrderId Id { get; private set; }
    public CustomerId CustomerId { get; private set; }
    public Money Total { get; private set; }
}
```

Mapped entity classes are non-sealed because generated Entity Framework NativeAOT materializers
must perform framework service checks against them. Identifiers and bounded scalar concepts remain
sealed typed values. Raw wire strings are parsed before they enter Domain operations.

### Complete persistence operation

The fixed query belongs in Db because Entity Framework's NativeAOT precompiler must see the
concrete context and complete expression in one operation. Its projection and return values remain
typed Domain concepts:

```csharp
// Db/Customers/QueryCustomerSummary.cs
namespace Example.Customers.Db.Customers;

using Example.Customers.Domain.Amounts;
using Example.Customers.Domain.Customers;
using Example.Customers.Domain.Orders;
using Microsoft.EntityFrameworkCore;
using static Example.Customers.Domain.Customers.Customers;

public static partial class Customers
{
    public static async Task<GetCustomerSummaryResult> QueryCustomerSummary(
        IDbContextFactory<SalesDbContext> dbContexts,
        CustomerId customerId,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        await using var database = await dbContexts.CreateDbContextAsync(cancellation);
        var queryCancellation = cancellation;

        var row = await (
            from customer in database.Customers.AsNoTracking()
            where customer.Id == customerId
            join order in database.Orders.AsNoTracking()
                on customer.Id equals order.CustomerId into customerOrders
            select new
            {
                customer.Id,
                customer.Name,
                OrderCount = customerOrders.Count(),
                TotalOrdered = customerOrders.Sum(order => (decimal?)order.Total.Amount) ?? 0m
            })
            .SingleOrDefaultAsync(queryCancellation);

        if (row is null)
        {
            return new GetCustomerSummaryResult.NotFound(customerId);
        }

        var standing = await CalculateCustomerStanding(
            row.OrderCount,
            new Money(row.TotalOrdered),
            cancellation);

        return new GetCustomerSummaryResult.Found(
            new CustomerSummary(
                row.Id,
                row.Name,
                row.OrderCount,
                new Money(row.TotalOrdered),
                standing));
    }
}
```

The local cancellation alias is deliberate: it preserves the caller token while keeping the
invocation statically materializable by the pinned Entity Framework precompiler. The anonymous
`row` exists only inside this function. It allows joins, aggregates, and partial column selection
without inventing a universal row type. `CustomerSummary` is retained because it has domain meaning
outside the query expression. Whole-entity materialization through `DbSet<T>` is forbidden,
including for queries that need every mapped property.

## Db

Db owns the concrete context and makes the shared migrated schema usable through Entity Framework.
It contains no business service and no generic repository.

```csharp
// Db/SalesDbContext.cs
namespace Example.Customers.Db;

using Example.Customers.Domain.Customers;
using Example.Customers.Domain.Orders;
using Microsoft.EntityFrameworkCore;
using static Example.Customers.Db.Customers.CustomerSchema;
using static Example.Customers.Db.Orders.OrderSchema;

public sealed class SalesDbContext(DbContextOptions<SalesDbContext> options)
    : DbContext(options)
{
    public DbSet<Customer> Customers { get; private set; } = null!;
    public DbSet<Order> Orders { get; private set; } = null!;

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        ConfigureCustomer(modelBuilder);
        ConfigureOrder(modelBuilder);
    }
}
```

```csharp
// Db/Customers/ConfigureCustomer.cs
namespace Example.Customers.Db.Customers;

using Example.Customers.Domain.Customers;
using Microsoft.EntityFrameworkCore;

internal static partial class CustomerSchema
{
    internal static void ConfigureCustomer(ModelBuilder modelBuilder)
    {
        var customer = modelBuilder.Entity<Customer>();
        customer.ToTable("customers");
        customer.HasKey(value => value.Id);
        customer.Property(value => value.Id)
            .HasConversion(
                value => value.ToString(),
                value => CustomerId.FromStorage(value))
            .HasColumnName("customer_id")
            .HasMaxLength(100);
        customer.Property(value => value.Name)
            .HasConversion(
                value => value.ToString(),
                value => CustomerName.FromStorage(value))
            .HasColumnName("name")
            .HasMaxLength(200);
        customer.Property(value => value.Revision).HasColumnName("revision").IsConcurrencyToken();
    }
}
```

This synchronous function exists only because `OnModelCreating` is a synchronous Entity Framework
contract. It is not a Domain operation.

### Provider selection

The process selects one implemented provider at startup from typed configuration. The selected
provider creates `DbContextOptions<SalesDbContext>` and a pooled context factory. Domain and Service
code do not branch on provider names. SQLite is the sole implemented provider until another
provider is explicitly added and proved.

Common queries stay in Db and execute through the configured context factory. When a future
provider requires materially different SQL or semantics, only that operation moves behind
purpose-specific provider functions:

```text
Db/Sqlite/Customers/QueryCustomerSearch.cs
Db/Postgres/Customers/QueryCustomerSearch.cs
```

Those files exist only after both variants are implemented. The escape hatch is selected once
during startup through one purpose-typed function delegate. It does not create a generic
repository, broad storage interface, or provider conditional in every operation. Both variants
return the same Domain result and pass the same canonical tests.

The SQLite provider is deployed as one service process per database. A fixed, finite set of
tenant-keyed asynchronous locks coordinates Tenant and child mutations before their Entity
Framework operations. The lock is released before any downstream call. A future provider that
admits multiple service processes replaces that purpose-specific coordination with
provider-appropriate cross-process atomicity while preserving the same Domain decisions and
canonical tests.

## Service

Service is a thin process and translation boundary. It owns:

- startup and typed configuration;
- dependency construction and process lifecycle;
- authentication facts supplied to the operation;
- request validation and conversion into Domain values;
- calls to Domain decisions and Db persistence operations;
- mapping Domain results into generated wire responses and statuses; and
- cancellation and deadline propagation;
- Kubernetes workload and invocation-JWT validation; and
- OpenTelemetry span, metric, and structured-log integration.

It does not contain service rules or database query expressions.

### Generated gRPC surface

`api/proto/v1/customerd.proto` is hand-authored:

```proto
syntax = "proto3";

package examples.customers.v1;

service CustomerService {
  rpc GetCustomerSummary(GetCustomerSummaryRequest)
      returns (GetCustomerSummaryResponse);
}

message GetCustomerSummaryRequest { string customer_id = 1; }

message GetCustomerSummaryResponse {
  string customer_id = 1;
  string name = 2;
  uint32 order_count = 3;
  string total_ordered = 4;
  string standing = 5;
}
```

The protobuf build generates messages, a typed `CustomerServiceClient`, and an abstract
`CustomerServiceBase`. Validation, Domain calls, authorization, and error mapping remain explicit.

### Request translation

```csharp
// Service/Grpc/Customers/ParseCustomerId.cs
internal static partial class CustomerRequests
{
    internal static ValueTask<CustomerId> ParseCustomerId(
        GetCustomerSummaryRequest request,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return CustomerId.Parse(request.CustomerId, cancellation);
    }
}
```

### Response translation

```csharp
// Service/Grpc/Customers/CreateCustomerSummaryResponse.cs
internal static partial class CustomerResponses
{
    internal static ValueTask<GetCustomerSummaryResponse> CreateCustomerSummaryResponse(
        GetCustomerSummaryResult result,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();

        return result switch
        {
            GetCustomerSummaryResult.Found found => ValueTask.FromResult(
                new GetCustomerSummaryResponse
                {
                    CustomerId = found.Summary.CustomerId.ToString(),
                    Name = found.Summary.CustomerName.ToString(),
                    OrderCount = checked((uint)found.Summary.OrderCount),
                    TotalOrdered = found.Summary.TotalOrdered.ToString(),
                    Standing = found.Summary.Standing.ToString()
                }),
            GetCustomerSummaryResult.NotFound => throw new RpcException(
                new Status(StatusCode.NotFound, "Customer not found")),
            _ => throw new UnreachableException()
        };
    }
}
```

### gRPC operation

The concrete gRPC class owns constructor state only:

```csharp
// Service/Grpc/CustomerGrpcService.cs
public sealed partial class CustomerGrpcService(
    IDbContextFactory<SalesDbContext> dbContexts)
    : CustomerService.CustomerServiceBase
{
    private readonly IDbContextFactory<SalesDbContext> _dbContexts = dbContexts;
}
```

Each RPC implementation has its own verb-named file:

```csharp
// Service/Grpc/Customers/GetCustomerSummary.cs
using static Example.Customers.Domain.Customers.Customers;
using static Example.Customers.Service.Grpc.Customers.CustomerRequests;
using static Example.Customers.Service.Grpc.Customers.CustomerResponses;

public sealed partial class CustomerGrpcService
{
    public override async Task<GetCustomerSummaryResponse> GetCustomerSummary(
        GetCustomerSummaryRequest request,
        ServerCallContext context)
    {
        var customerId = await ParseCustomerId(request, context.CancellationToken);

        var result = await QueryCustomerSummary(
            _dbContexts,
            customerId,
            context.CancellationToken);

        return await CreateCustomerSummaryResponse(
            result,
            context.CancellationToken);
    }
}
```

The complete flow is therefore visible without a use-case object or dependency record:

```text
customerd.proto
      |
      v
generated request -> ParseCustomerId
                          |
                          v
                 QueryCustomerSummary
                   |              |
                   v              v
              Customers       Orders
                   \              /
                    v            v
                 Domain result
                          |
                          v
           CreateCustomerSummaryResponse
                          |
                          v
                 generated response
```

## Mutations and transactions

A mutation follows the same projection rule. Its Db operation creates the context and starts a
transaction when needed. It explicitly projects the complete stored state required by the
transition, asks a verb-named Domain function to rehydrate the mapped Domain entity, attaches that
entity to the context, records the projected concurrency revision as the original value, calls the
Domain decision function, and commits only after the decision succeeds. Domain creates the complete
typed audit intent for each contract-required outcome. Reads, retries, no-ops, denials, and failures
create no audit intent unless their service contract explicitly requires one.

Rehydration validates storage invariants and reconstructs the same Domain entity used for creation
and business logic. It does not introduce an `Entity`, `Row`, `Record`, or other parallel
persistence model. Create operations add a newly created Domain entity directly and do not
rehydrate it. Delete and update operations still use explicit projections rather than direct
entity-returning Entity Framework materialization.

Every projected mutation member, rehydration path, attach/update path, optimistic-concurrency path,
and generated query interceptor executes in the real NativeAOT integration suite.

Db persists only service-owned domain state. After Db completes and no database transaction is
held, Service maps the Domain-produced audit intent to the shared wire contract and calls
`auditd.RecordAuditBatch` directly before returning the corresponding outcome. Infrastructure
failures are mapped through a Domain function to the required typed failure evidence and submitted
the same way. No local audit outbox, queue, retry journal, source sequence, or fallback path exists.

Entity Framework mappings and common migrations contain structural schema only. C# behavior must
not depend on a database trigger, stored procedure, user-defined database function, computed side
effect, or provider-resident business rule. Immutability, state transitions, parent checks, revision
advancement, no-op handling, and audit intent are explicit Domain code and are exercised through
the shipping process.

Functions accept only the concrete inputs they use: the purpose-specific context factory, typed
Domain values, and cancellation. Do not pass `DbSet<T>` or `IQueryable<T>` across project
boundaries, or introduce a broad repository, service locator, or `Dependencies` record.

## Errors and cancellation

Domain returns closed, purpose-named results for expected outcomes. It throws only for violated
program invariants or failed infrastructure primitives that cannot be represented as a specified
outcome. Service maps expected Domain outcomes to the exact gRPC status and error details declared
by the shared API.

Every I/O function receives and propagates `CancellationToken`. Service uses the gRPC call token;
Db passes a local alias of it to each precompiled Entity Framework operation; outbound adapters pass
it to generated clients. Code does not replace a caller deadline with an unbounded token or convert
asynchronous work into blocking calls.

## Schema and migrations

C# projects never own schema migrations. They contain no Entity Framework migration history and do
not call `EnsureCreated`, `Migrate`, or equivalent startup schema mutation.

Deployment runs the Knex migration job before starting the C# Service process. The build
deterministically embeds the exact ordered compiled migration filenames in the native artifact.
Readiness queries `knex_migrations` and succeeds only when its ordered names equal that embedded
manifest. C# owns no second schema-version table or manually maintained version number.

Entity Framework mappings must match the common Knex schema exactly. A mismatch fails build-time
schema verification or process readiness; the service must not silently repair it.

Mapped closed enums use explicit exhaustive Domain-to-storage and storage-to-Domain conversions.
Generic enum converters that require runtime enum discovery are forbidden in the NativeAOT path.

## Testing

The service-root TypeScript suite is the authoritative C# behavior suite, exactly as it is for any
other implementation. It starts the published process, applies the real Knex migrations, calls the
public wire API, and verifies the same behavior without C#-specific branches.

`csharp/tests/` contains only C#-specific integration evidence, for example:

- NativeAOT publication succeeds without unexpected trim or AOT diagnostics;
- the native artifact starts without the development SDK or managed fallback;
- Entity Framework's selected provider and mappings match the migrated schema; and
- packaging, shutdown, and diagnostics behave correctly in the shipping native process.

It does not repeat RPC success, validation, authorization, pagination, or failure scenarios owned
by the canonical suite.

Authentication, telemetry, NativeAOT publication, and the implementation release gates are defined
in [C# Runtime and Release](runtime/).
