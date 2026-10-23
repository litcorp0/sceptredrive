import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { DrawerPin, PrintJob, PrintOutcome } from '../../shared/printing'
import { buildDrawerBytes, buildReceiptBytes } from './escpos'

/**
 * The fake ESC/POS printer (D28).
 *
 * Used in development, CI, and the packaged smoke test. It writes exactly what
 * the real adapter would send, so the verification script can assert columns,
 * money fields, the cut, and the drawer key without hardware.
 *
 * Failure simulation is file-based rather than env-based so a running app can
 * be made to fail and then recover without a restart:
 * - `.fail-next`  → the next print fails once, then is removed;
 * - `.fail-always` → every print fails until the file is removed.
 */

export const FAIL_NEXT_FILE = '.fail-next'
export const FAIL_ALWAYS_FILE = '.fail-always'
export const DRAWER_LOG_FILE = 'drawer.log'

const SAFE_RECEIPT = /^[A-Za-z0-9-]{1,64}$/

export function fakePrint(receiptsDir: string, job: PrintJob): PrintOutcome {
  if (!SAFE_RECEIPT.test(job.receiptNumber)) {
    return {
      ok: false,
      code: 'PRINTER_FAILED',
      message: 'The receipt number is not printable',
    }
  }

  mkdirSync(receiptsDir, { recursive: true })

  if (existsSync(path.join(receiptsDir, FAIL_ALWAYS_FILE))) {
    return failure()
  }
  const failNext = path.join(receiptsDir, FAIL_NEXT_FILE)
  if (existsSync(failNext)) {
    rmSync(failNext, { force: true })
    return failure()
  }

  const text = job.lines.map((line) => line.text).join('\n')
  const textPath = path.join(receiptsDir, `${job.receiptNumber}.txt`)
  const binaryPath = path.join(receiptsDir, `${job.receiptNumber}.escpos.bin`)

  writeFileSync(textPath, `${text}\n`, 'utf8')
  const bytes = buildReceiptBytes(job, job.copies)
  writeFileSync(binaryPath, Buffer.from(bytes))

  if (job.openDrawer) {
    appendDrawerLog(receiptsDir, `${job.receiptNumber} pin=${job.drawerPin}`)
  }

  return { ok: true, bytes: bytes.length }
}

export function fakeOpenDrawer(receiptsDir: string, pin: DrawerPin): PrintOutcome {
  mkdirSync(receiptsDir, { recursive: true })
  if (existsSync(path.join(receiptsDir, FAIL_ALWAYS_FILE))) {
    return {
      ok: false,
      code: 'DRAWER_FAILED',
      message: 'The drawer could not be opened',
    }
  }
  const bytes = buildDrawerBytes(pin)
  appendDrawerLog(receiptsDir, `standalone pin=${pin}`)
  return { ok: true, bytes: bytes.length }
}

function failure(): PrintOutcome {
  return {
    ok: false,
    code: 'PRINTER_FAILED',
    message: 'The printer did not accept the job',
  }
}

function appendDrawerLog(receiptsDir: string, detail: string): void {
  appendFileSync(
    path.join(receiptsDir, DRAWER_LOG_FILE),
    `${new Date().toISOString()} ${detail}\n`,
    'utf8',
  )
}
