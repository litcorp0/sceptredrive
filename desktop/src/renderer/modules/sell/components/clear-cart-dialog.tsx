import { useDialogFocusReturn } from '@/components/common'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatGhs } from '@/lib/format'

/**
 * The clear-the-sale confirmation (Plan 03's dialog, Plan 06 Task 2's shape).
 *
 * Its own component so `useDialogFocusReturn` captures the Clear button when the
 * dialog mounts, not the selling page when it first rendered. `Dialog` has no
 * trigger here — the page owns the open state — so the hook is what returns
 * focus.
 */
export function ClearCartDialog({
  itemCount,
  totalMinor,
  onClose,
  onConfirm,
}: {
  itemCount: number
  totalMinor: number
  onClose: () => void
  onConfirm: () => void
}) {
  const focusReturn = useDialogFocusReturn()

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        {...focusReturn}
        data-testid="clear-cart-dialog"
        className="flex max-h-[90vh] max-w-md flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
      >
        <DialogHeader className="border-b border-border px-5 py-4 pr-16">
          <DialogTitle className="text-base">Clear the sale?</DialogTitle>
          <DialogDescription>The cart and its draft will be discarded.</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <p className="text-sm text-muted-foreground">
            {itemCount} item{itemCount === 1 ? '' : 's'} worth{' '}
            <span className="font-mono tabular-nums">{formatGhs(totalMinor)}</span> will be removed.
          </p>
        </div>

        <DialogFooter className="border-t border-border px-5 py-3">
          <div className="flex w-full gap-2">
            <Button type="button" variant="outline" onClick={onClose} className="h-11 flex-1">
              Keep cart
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={onConfirm}
              className="h-11 flex-1"
              data-testid="confirm-clear"
            >
              Clear sale
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
