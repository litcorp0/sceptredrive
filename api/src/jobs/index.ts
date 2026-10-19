import { startBoss, stopBoss } from './boss.ts'
import { registerJobHandlers } from './queues.ts'

/** Boots pg-boss, then registers queues, workers, and schedules. */
export async function startJobs(): Promise<void> {
  const boss = await startBoss()
  await registerJobHandlers(boss)
}

/** Stops pg-boss; call before closing the shared database pool. */
export async function stopJobs(): Promise<void> {
  await stopBoss()
}
