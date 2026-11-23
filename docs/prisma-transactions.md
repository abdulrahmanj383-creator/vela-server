# Prisma Transaction Patterns

## When to use transactions

Use a Prisma transaction whenever two or more writes must succeed or fail together.
Critical cases in Vela:

| Operation                        | Tables involved                                      |
| -------------------------------- | ---------------------------------------------------- |
| Create payment + consume request | `payments` + `payment_requests` + `used_request_ids` |
| Confirm payment + index history  | `payments` + `transactions`                          |
| Anti-replay on NFC tap           | `used_request_ids` + `payment_requests`              |

## Pattern 1 — Interactive transaction (preferred)

Use when you need to read between writes or apply conditional logic.

```typescript
const payment = await this.prisma.$transaction(async (tx) => {
  const request = await tx.paymentRequest.findUniqueOrThrow({
    where: { id: paymentRequestId },
  });

  if (request.status !== 'CREATED') {
    throw new ConflictException({ code: 'PAYMENT_REQUEST_ALREADY_CONSUMED' });
  }

  const [newPayment] = await Promise.all([
    tx.payment.create({ data: { ...paymentData } }),
    tx.paymentRequest.update({
      where: { id: paymentRequestId },
      data: { status: 'CONSUMED' },
    }),
    tx.usedRequestId.create({
      data: {
        requestId: request.externalRequestId!,
        paymentRequestId: request.id,
      },
    }),
  ]);

  return newPayment;
});
```

## Pattern 2 — Sequential writes transaction

Use for simple multi-table writes without intermediate reads.

```typescript
const [updatedPayment, transaction] = await this.prisma.$transaction([
  this.prisma.payment.update({
    where: { id: paymentId },
    data: { status: 'CONFIRMED', confirmedAt: new Date(), stellarTxHash },
  }),
  this.prisma.transaction.create({
    data: { userId, paymentId, stellarTxHash, direction: 'SENT', ...rest },
  }),
]);
```

## Critical rule — no network calls inside transactions

Prisma interactive transactions default to a 5 second timeout. Never include
Stellar or external HTTP calls inside a transaction.

```typescript
// Wrong — network call inside transaction can timeout
const payment = await this.prisma.$transaction(async (tx) => {
  const txHash = await this.stellarService.submit(xdr); // network call
  await tx.payment.update({ ... });
});

// Correct — resolve network call first, then commit to DB
const txHash = await this.stellarService.submit(xdr);
await this.prisma.$transaction([
  this.prisma.payment.update({ where: { id }, data: { stellarTxHash: txHash, status: 'SUBMITTED' } }),
]);
```

## Anti-patterns to avoid

## Migration rollback limits

Prisma migrations are forward-only in the shared repository. Before applying a
payment migration, take a database backup and confirm that the migration has
been reviewed against the current production schema. `prisma migrate deploy`
does not provide an automatic rollback command.

When a deployment must be stopped:

1. Stop application writes or route traffic to the previous compatible release.
2. Record the migration name, database provider, and last successful backup.
3. Restore the backup in an isolated database and verify payment, request, and
   transaction counts before considering recovery.
4. If the migration is additive and the old application can safely read the
   new schema, roll the application back without deleting columns or rows.
5. For destructive or incompatible changes, write and review a separate
   forward migration. Do not hand-edit `_prisma_migrations` or use an ad-hoc
   `DROP`, `DELETE`, or `TRUNCATE` as a rollback.

Payment rows and Stellar transactions cannot be rolled back together: a
database restore does not undo a transaction already submitted to Horizon.
After recovery, reconcile locally stored hashes and statuses against Horizon
before accepting new payment traffic. This project uses testnet for local and
CI verification; never use production identifiers or keys in a rehearsal.

For the release checklist, document the backup identifier, migration names,
compatibility decision, and reconciliation result. If a schema change needs a
coordinated application or protocol change, keep it as a separate migration
and release rather than bundling an emergency rollback into an unrelated fix.

```typescript
// Two separate writes — not atomic
await this.prisma.payment.update({ where: { id }, data: { status: 'CONFIRMED' } });
await this.prisma.transaction.create({ data: { ... } }); // can fail independently

// Raw SQL without parameterization — never do this
await this.prisma.$queryRawUnsafe(`UPDATE payments SET status = '${status}'`);

// Parameterized raw query — only when Prisma ORM can't express it
await this.prisma.$queryRaw`UPDATE payments SET status = ${status} WHERE id = ${id}`;
```
