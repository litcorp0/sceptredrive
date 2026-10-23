import type { PowerSyncDatabase } from '@powersync/web'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from 'react'
import type { PosConfigSnapshot } from '../api/types'
import { loadCartDraft, saveCartDraft } from './cart-repository'
import { cartReducer, emptyCart } from './reducer'
import { type CartPricingContext, type CartTotals, computeCartTotals } from './totals'
import type { CartAction, CartCustomer, CartState, SellableProduct } from './types'

/**
 * The selling cart, shared by the sell and tender screens.
 *
 * State lives in memory for responsiveness and is written to the local draft
 * table ~150 ms after every change (one transaction per write), so a crash
 * loses nothing but the last keystroke. Restoring happens once per shift.
 */

interface CartContextValue {
  state: CartState
  totals: CartTotals
  pricing: CartPricingContext
  status: 'loading' | 'ready'
  error: string | null
  dispatch: (action: CartAction) => void
  addProduct: (product: SellableProduct, quantity?: number) => void
  setCustomer: (customer: CartCustomer | null) => void
  clear: () => void
}

const CartContext = createContext<CartContextValue | null>(null)

export const DRAFT_WRITE_DELAY_MS = 150

export function cartPricingContext(config: PosConfigSnapshot): CartPricingContext {
  return {
    taxMode: config.taxMode,
    loyalty: {
      pointsPerCedi: config.loyalty.pointsPerCedi,
      earnPointsPerCedi: config.loyalty.earnPointsPerCedi,
    },
  }
}

export function CartProvider({
  db,
  shiftId,
  config,
  children,
}: {
  db: PowerSyncDatabase
  shiftId: string
  config: PosConfigSnapshot
  children: ReactNode
}) {
  const [state, rawDispatch] = useReducer(cartReducer, undefined, () => emptyCart({ shiftId }))
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')
  const [error, setError] = useState<string | null>(null)

  const pricing = useMemo(() => cartPricingContext(config), [config])
  const totals = useMemo(() => computeCartTotals(state, pricing), [state, pricing])

  const dispatch = useCallback((action: CartAction) => {
    rawDispatch({ ...action, now: new Date().toISOString() } as CartAction)
  }, [])

  const addProduct = useCallback(
    (product: SellableProduct, quantity = 1) => {
      dispatch({ type: 'addProduct', product, quantity })
    },
    [dispatch],
  )

  const setCustomer = useCallback(
    (customer: CartCustomer | null) => {
      dispatch({ type: 'setCustomer', customer })
    },
    [dispatch],
  )

  const clear = useCallback(() => {
    dispatch({ type: 'clear' })
  }, [dispatch])

  // Restore the draft left by a crash, but only when it belongs to this shift.
  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    void loadCartDraft(db, shiftId)
      .then((restored) => {
        if (cancelled) return
        rawDispatch(restored ? { type: 'hydrate', state: restored } : { type: 'clear' })
        setStatus('ready')
      })
      .catch((loadError: unknown) => {
        if (cancelled) return
        // A failed restore must not stop the till: start empty and tell the cashier.
        setError(
          loadError instanceof Error
            ? `Could not restore the cart: ${loadError.message}`
            : 'Could not restore the cart',
        )
        setStatus('ready')
      })
    return () => {
      cancelled = true
    }
  }, [db, shiftId])

  useEffect(() => {
    if (status !== 'ready') return
    const timer = setTimeout(() => {
      void saveCartDraft(db, state).catch((saveError: unknown) => {
        setError(
          saveError instanceof Error
            ? `Could not save the cart: ${saveError.message}`
            : 'Could not save the cart',
        )
      })
    }, DRAFT_WRITE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [db, state, status])

  const value = useMemo<CartContextValue>(
    () => ({ state, totals, pricing, status, error, dispatch, addProduct, setCustomer, clear }),
    [state, totals, pricing, status, error, dispatch, addProduct, setCustomer, clear],
  )

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext)
  if (!context) {
    throw new Error('useCart must be used inside <CartProvider>')
  }
  return context
}
