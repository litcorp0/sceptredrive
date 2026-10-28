import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { resetTerminalData } from '@/lib/auth/terminal-reset'

/**
 * The explicit way out of a terminal whose server-side identity no longer
 * exists. Re-enrolment alone keeps local sales and cached data; this deletes
 * them, so it is a separate, confirmed action.
 */
export function ResetTerminalButton({
  label = 'Reset this terminal',
  className,
}: {
  label?: string
  className?: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function reset() {
    setBusy(true)
    setError(null)
    try {
      await resetTerminalData()
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Could not reset this terminal')
      setBusy(false)
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className={className}>
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Reset this terminal?</AlertDialogTitle>
          <AlertDialogDescription>
            This deletes every local sale, held cart, cached product and staff record, and the
            device credential. Sales that have not synced yet will be lost. Use it only after the
            server database was reset or when this machine is being reassigned.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button type="button" variant="destructive" onClick={reset} disabled={busy}>
              {busy ? 'Resetting…' : 'Reset terminal'}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
