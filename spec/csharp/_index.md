---
title: C# Implementation
weight: 31
---

This page defines the C# realization of a CtlFlow service. It applies only inside a service's
`csharp/` directory. It does not define the internal architecture for another language
implementation; those implementations use patterns natural to their own languages while
meeting the shared contract in [Implementation](../implementation/).

The C# design is deliberately small and functional. A service has three production projects:

- **Domain** owns service concepts, invariants, decisions, and database queries.
- **Db** owns the concrete Entity Framework context, mappings, and provider configuration.
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
  knexfile.js
  migrations/0001_create_customers.js
  migrations/0002_create_orders.js
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
          QueryCustomerSummary.cs
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
        Orders/
          ConfigureOrder.cs
        Providers/
          DatabaseProvider.cs
          CreateDbContextFactory.cs
        Sqlite/
          ConfigureSqlite.cs
        Postgres/
          ConfigurePostgres.cs
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

Only supported providers and necessary implementation-local tests are present. Empty provider
directories are not checked in.

## Dependencies

| Project | May reference | Must not own |
| --- | --- | --- |
| Domain | BCL and Entity Framework query abstractions | Wire types, hosting, provider selection, schema migrations |
| Db | Domain, Entity Framework, selected database providers | Business rules, gRPC translation, schema migrations |
| Service | Domain, Db, generated gRPC bindings, hosting libraries | Domain rules, provider-specific queries, schema migrations |

Domain's use of Entity Framework query abstractions is intentional. This is a
persistence-aware functional domain, not a textbook persistence-ignorant Clean Architecture. It
keeps each query with the service logic that gives it meaning and avoids generic repositories that
hide useful database semantics.

```text
Service -> Domain
Service -> Db -> Domain
Domain  -> Entity Framework query abstractions
```

## Functional source rules

C# does not have free module functions, so partial static classes act only as namespaces for
related functions. Use a concise domain noun for the module and a semantic verb phrase for each
function. The complete Domain example below defines `public static partial class Customers`; call
sites import that module with `using static` and call the function directly:

```csharp
using static Example.Customers.Domain.Customers.Customers;

var result = await QueryCustomerSummary(
    db.Customers,
    db.Orders,
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

A query that returns only selected columns uses a local projection or a purpose-named Domain result.
That projection is not a third persistence model:

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

Separate persistence-only records are an escape hatch for concrete needs such as transactional
outbox rows, idempotency records, encrypted storage envelopes, or provider-specific materialized
views. Their file and name must state that storage purpose. They never leak into the wire contract.

## Domain

Domain owns:

- validated identifiers, names, amounts, states, and other service concepts;
- entities and relationships;
- invariant checks and state transitions;
- common Entity Framework query expressions;
- purpose-named query results; and
- closed success and failure results used by Service translation.

Domain does not know protobuf, gRPC, HTTP, process environment, Kubernetes, database connection
strings, or a concrete database provider.

### Domain entities

The entity used by business logic is also mapped by Entity Framework:

```csharp
// Domain/Customers/Customer.cs
public sealed class Customer
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
public sealed class Order
{
    private Order() { }
    public Order(OrderId id, CustomerId customerId, Money total)
        => (Id, CustomerId, Total) = (id, customerId, total);
    public OrderId Id { get; private set; }
    public CustomerId CustomerId { get; private set; }
    public Money Total { get; private set; }
}
```

Identifiers and bounded scalar concepts are typed values. Raw wire strings are parsed before they
enter Domain operations.

### Complete query

The query belongs in Domain because its selection and result express service meaning:

```csharp
// Domain/Customers/QueryCustomerSummary.cs
namespace Example.Customers.Domain.Customers;

using Example.Customers.Domain.Amounts;
using Example.Customers.Domain.Orders;
using Microsoft.EntityFrameworkCore;

public static partial class Customers
{
    public static async Task<GetCustomerSummaryResult> QueryCustomerSummary(
        IQueryable<Customer> customers,
        IQueryable<Order> orders,
        CustomerId customerId,
        CancellationToken cancellation)
    {
        var row = await (
            from customer in customers.AsNoTracking()
            where customer.Id == customerId
            join order in orders.AsNoTracking()
                on customer.Id equals order.CustomerId into customerOrders
            select new
            {
                customer.Id,
                customer.Name,
                OrderCount = customerOrders.Count(),
                TotalOrdered = customerOrders.Sum(order => (decimal?)order.Total.Amount) ?? 0m
            })
            .SingleOrDefaultAsync(cancellation);

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

The anonymous `row` exists only inside this function. It allows joins, aggregates, and partial
column selection without inventing a universal row type. `CustomerSummary` is retained because it
has domain meaning outside the query expression.

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
    public DbSet<Customer> Customers => Set<Customer>();
    public DbSet<Order> Orders => Set<Order>();

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

The process selects one supported provider at startup from typed configuration. The selected
provider creates `DbContextOptions<SalesDbContext>` and a pooled context factory. Domain and Service
code do not branch on provider names.

Common queries stay in Domain and execute against either provider. A query moves behind a
provider-specific function only when the providers require materially different SQL or semantics:

```text
Db/Sqlite/Customers/QueryCustomerSearch.cs
Db/Postgres/Customers/QueryCustomerSearch.cs
```

That escape hatch is selected once during startup through one purpose-typed function delegate. It
does not create a generic repository, broad storage interface, or provider conditional in every
Domain function. Both variants return the same Domain result and pass the same canonical tests.

## Service

Service is a thin process and translation boundary. It owns:

- startup and typed configuration;
- dependency construction and process lifecycle;
- authentication facts supplied to the operation;
- request validation and conversion into Domain values;
- concrete context creation and disposal;
- calls to Domain functions;
- mapping Domain results into generated wire responses and statuses; and
- cancellation and deadline propagation.

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

        await using var db = await _dbContexts.CreateDbContextAsync(
            context.CancellationToken);

        var result = await QueryCustomerSummary(
            db.Customers,
            db.Orders,
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

A mutation follows the same shape. Service creates the context and starts a transaction when the
specified operation needs one. Domain functions query tracked entities, apply invariants, and
produce typed results. Service commits through the context only after the Domain function succeeds.

For a mutation that must atomically write an audit outbox entry, both entities are added to the same
context and saved in the same transaction. No network call occurs inside that transaction. A
downstream call needed before the decision completes before the transaction begins; a call needed
after commit is driven by the committed outbox.

Functions accept only the concrete inputs they use: relevant `DbSet<T>` or `IQueryable<T>` values,
typed Domain values, and cancellation. Do not pass a broad repository, service locator, or
`Dependencies` record.

## Errors and cancellation

Domain returns closed, purpose-named results for expected outcomes. It throws only for violated
program invariants or failed infrastructure primitives that cannot be represented as a specified
outcome. Service maps expected Domain outcomes to the exact gRPC status and error details declared
by the shared API.

Every I/O function receives and propagates `CancellationToken`. Service uses the gRPC call token;
Domain passes it to Entity Framework; outbound adapters pass it to generated clients. Code does not
replace a caller deadline with an unbounded token or convert asynchronous work into blocking calls.

## Schema and migrations

C# projects never own schema migrations. They contain no Entity Framework migration history and do
not call `EnsureCreated`, `Migrate`, or equivalent startup schema mutation.

Deployment runs the Knex migration job and verifies the schema revision before starting the C#
Service process. Readiness succeeds only against that verified revision.

Entity Framework mappings must match the common Knex schema exactly. A mismatch fails build-time
schema verification or process readiness; the service must not silently repair it.

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

## NativeAOT profile

Every shipping C# Service project publishes as NativeAOT. Native publication is a release gate, not
an optional optimization. A package may be used only when its required paths are compatible with
trimming and NativeAOT. Runtime code generation, reflection-based serializers, managed fallback
artifacts, and separate non-native behavior paths are forbidden.

Use generated protobuf bindings, source-generated closed-world metadata where needed, bounded
asynchronous I/O, pooled long-lived clients and context factories, and finite concurrency. Native
tests exercise the actual published binary and real database provider rather than a managed test
host.

SQLite is the required database provider. Its connection and file lifecycle live under
`Db/Sqlite/`. Every additional supported provider belongs in its own `Db/<Provider>/` directory,
uses the same Domain operations, and reaches the same Knex-owned logical schema and canonical
behavior. A provider does not change the gRPC contract or create another service implementation.

## Review checklist

A C# service implementation is structurally complete when:

1. it has exactly the Domain, Db, and Service production projects;
2. its generated wire code comes only from the service-root protobuf contract;
3. wire types remain in Service and concrete provider concerns remain in Db;
4. Domain entities are mapped directly unless a named persistence escape hatch is justified;
5. queries and decisions are semantic functions in verb-named files;
6. call sites use direct functions rather than use-case, command-handler, or repository ceremony;
7. all CtlFlow-owned operation APIs are awaitable and omit the `Async` suffix;
8. Knex remains the only migration authority;
9. the unchanged canonical suite passes against the NativeAOT process; and
10. implementation-local tests contain only C#-specific release evidence.
