// How a class gets paid for. One list, because the same choice is offered on the
// recurring class form, the single class form, the bulk editor, the add-dates modal and
// the client's own profile — and they had drifted apart: the recurring form was missing
// Invoice and Package, so a weekly class could never be set to bill the way 21 of them
// actually do.
// Only these three are real ways a class is paid for (Sarede, 2026-09-23). Zelle, Check,
// Cash and Other were never used on a single class, so they're gone.
export const PAYMENT_METHODS = ['Credit Card', 'Invoice', 'Package']
