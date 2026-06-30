# FNB/LIS

Modernization workspace for the FNB/LIS inventory, audit, reconciliation, and
reporting system.

## Documentation

- [Master implementation plan](docs/fnb_master_implementation_plan.md)
- [Master implementation tracker](docs/fnb_master_implementation_tracker.md)
- [Legacy system documentation](docs/fnb_legacy_system_documentation.md)
- [Legacy workflow](docs/fnb-workflow.md)
- [Legacy database keys](docs/fnb-database-keys.md)

## Prototype

The first implementation target is the role-aware web prototype in `apps/web`.

```bash
pnpm install
pnpm dev
```

Quality checks:

```bash
pnpm typecheck
pnpm test
pnpm build
```
