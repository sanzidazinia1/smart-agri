// Gives each user's pots serial numbers: POT-1, POT-2, …
import type { Prisma } from "@prisma/client";

// Display code for a pot number, e.g. 3 -> "POT-3"
export const potCode = (number: number) => `POT-${number}`;

// Next pot number for a user; the lock stops two pots getting the same number
export async function nextPotNumber(tx: Prisma.TransactionClient, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`pot-number:${userId}`}))`;
  const max = await tx.pot.aggregate({ where: { userId }, _max: { number: true } });
  return (max._max.number ?? 0) + 1;
}
