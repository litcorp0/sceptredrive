// Domain schemas are added per phase:
// - Plan 02: org (branch, terminal, device, enrollment) and platform (audit, settings)
// - Plan 03: auth (Better Auth generated)
// - Phase 2+: catalog, inventory, customers, loyalty, suppliers, pos, sync
export * from './auth.ts'
export * from './org.ts'
export * from './platform.ts'
