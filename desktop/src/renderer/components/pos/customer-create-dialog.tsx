import { formatGhanaPhone, normalizeGhanaPhone } from '@gikautos/shared'
import { type FormEvent, useState } from 'react'
import { CUSTOMER_NAME_MAX, createCustomerDraft } from '../../lib/customers/create-draft'
import type { CustomerHit } from '../../lib/customers/search'
import { usePosDatabase } from '../../lib/powersync/provider'
import { Modal } from './modal'

/**
 * Create a customer offline (Plan 06 Task 3).
 *
 * Only a name and a valid Ghana phone are needed — the same identity the API
 * will insert or match when the sale syncs. The form tells the cashier what
 * will happen ("new customer, links on sync") rather than implying the record
 * is already on the server.
 */
export function CustomerCreateDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (customer: CustomerHit) => void
}) {
  const db = usePosDatabase()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [alreadyExists, setAlreadyExists] = useState<CustomerHit | null>(null)

  const normalized = phone.trim() ? normalizeGhanaPhone(phone) : null
  const phoneInvalid = phone.trim().length > 0 && normalized === null

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!name.trim()) {
      setError('A name is required')
      return
    }
    if (!normalized) {
      setError('Enter a valid Ghana phone number, e.g. 024 123 4567')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const result = await createCustomerDraft(db, { name, phone })
      if (result.status === 'created') {
        onCreated(result.customer)
        onClose()
        return
      }
      if (result.status === 'existing') {
        // Not an error: the right move is to use the existing identity.
        setAlreadyExists(result.customer)
        return
      }
      setError(
        result.status === 'invalid_phone'
          ? 'Enter a valid Ghana phone number, e.g. 024 123 4567'
          : 'Enter the customer name',
      )
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not create the customer')
    } finally {
      setBusy(false)
    }
  }

  if (alreadyExists) {
    return (
      <Modal
        title="Customer already exists"
        description="This phone number is already on the till."
        onClose={onClose}
        testId="customer-exists"
        footer={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-10 flex-1 rounded-md border border-border text-sm font-medium hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                onCreated(alreadyExists)
                onClose()
              }}
              className="h-10 flex-1 rounded-md bg-primary text-sm font-semibold text-primary-foreground"
              data-testid="use-existing-customer"
            >
              Use {alreadyExists.name}
            </button>
          </div>
        }
      >
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{alreadyExists.name}</span> ·{' '}
          {formatGhanaPhone(alreadyExists.phone)}
          {alreadyExists.isDraft ? ' (created on this terminal, not synced yet)' : ''}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Select the existing customer instead of creating a second identity for one phone number.
        </p>
      </Modal>
    )
  }

  return (
    <Modal
      title="New customer"
      description="Saved on this terminal now and linked to the server when the sale syncs."
      onClose={onClose}
      testId="customer-create-dialog"
      footer={
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 flex-1 rounded-md border border-border text-sm font-medium hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="customer-create-form"
            disabled={busy || phoneInvalid || !name.trim()}
            className="h-10 flex-1 rounded-md bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
            data-testid="save-customer"
          >
            {busy ? 'Saving…' : 'Create customer'}
          </button>
        </div>
      }
    >
      <form id="customer-create-form" onSubmit={submit} className="grid gap-4">
        <label htmlFor="customer-name" className="grid gap-1.5 text-sm font-medium">
          Name
          <input
            id="customer-name"
            data-autofocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={CUSTOMER_NAME_MAX}
            className="h-11 rounded-md border border-border bg-background px-3 text-sm"
            placeholder="Akosua Mensah"
          />
        </label>

        <label htmlFor="customer-phone" className="grid gap-1.5 text-sm font-medium">
          Phone
          <input
            id="customer-phone"
            inputMode="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            className={`h-11 rounded-md border bg-background px-3 text-sm ${
              phoneInvalid ? 'border-destructive' : 'border-border'
            }`}
            placeholder="024 123 4567"
            aria-invalid={phoneInvalid}
            aria-describedby={phoneInvalid ? 'customer-phone-error' : 'customer-phone-hint'}
          />
        </label>

        {phoneInvalid ? (
          <p id="customer-phone-error" role="alert" className="text-sm text-destructive">
            Not a valid Ghana number. Use 0XXXXXXXXX or +233XXXXXXXXX.
          </p>
        ) : (
          <p id="customer-phone-hint" className="text-xs text-muted-foreground">
            {normalized
              ? `Will be saved as ${normalized}`
              : 'A phone number is required for credit and loyalty.'}
          </p>
        )}

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  )
}
