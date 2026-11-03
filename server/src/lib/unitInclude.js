// Shared include for a unit with its tower/estate and a minimal owner. Lives in
// lib so both unitService and leasingTransactionService can use it without a
// circular import between the two services.
export const UNIT_HIERARCHY_INCLUDE = { tower: { include: { estate: true } }, owner: { select: { id: true, name: true } } };
