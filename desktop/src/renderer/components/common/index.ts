/**
 * Chrome shared by more than one module (P10-D9).
 *
 * `manager-override-dialog.tsx` is imported by both the sell and the tender
 * page, so it cannot live inside either module's barrel; `screen-header.tsx` is
 * the heading block five counter screens share; `pin-pad.tsx` is used by the
 * override dialog and by the auth module's unlock and sign-in screens.
 *
 * Dialogs use the registry `Dialog` (`@/components/ui/dialog`) directly: the
 * hand-written `Modal` shell was deleted in Plan 03.
 */
export { ManagerOverrideDialog } from './manager-override-dialog'
export { PinPad } from './pin-pad'
export { ScreenHeader } from './screen-header'
export { useDialogFocusReturn } from './use-dialog-focus-return'
