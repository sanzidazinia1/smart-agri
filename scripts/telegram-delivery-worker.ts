// One-shot script (run by cron) that sends all waiting Telegram messages.
import { prisma } from "../src/lib/db";
import { runTelegramDeliveryWorkerUntilIdle } from "../src/lib/telegram-outbox";

// Sends queued Telegram messages until none are left
async function main() {
  const result = await runTelegramDeliveryWorkerUntilIdle();
  console.info("Telegram delivery worker completed", result);
}

// Run it, report failure via the exit code, and always close the DB connection
main()
  .catch((error: unknown) => {
    console.error("Telegram delivery worker failed", error instanceof Error ? error.message : "unknown error");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
