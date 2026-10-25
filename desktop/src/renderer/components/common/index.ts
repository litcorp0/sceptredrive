/**
 * Chrome shared by more than one module (P10-D9).
 *
 * `modal.tsx` is the dialog shell (`Modal` is deleted in Plan 03);
 * `manager-override-dialog.tsx` is imported by both the sell and the tender
 * page, so it cannot live inside either module's barrel;
 * `pin-pad.tsx` is used by the override dialog and by the auth module's
 * unlock and sign-in screens.
 */
export { ManagerOverrideDialog } from './manager-override-dialog'
export { Modal } from './modal'
export { PinPad } from './pin-pad'
