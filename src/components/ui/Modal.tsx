import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface ModalProps {
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Tailwind max-width class for the card. Default `max-w-md`. */
  widthClass?: string;
  /**
   * Whether clicking the backdrop closes the modal. Default true; form-heavy
   * modals (the transaction editor) opt out so an accidental click can't
   * discard a half-filled form.
   */
  closeOnBackdrop?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  /**
   * Accessible label for the × button: pass t(locale, "common.close"). It is
   * required on purpose — a default would ship in one language only.
   */
  closeLabel: string;
}

/** Everything Tab can land on, before dropping what turns out not to be a stop. */
const TAB_STOPS = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * The dialog's tab stops in Tab order. Left out: disabled controls, ones
 * that are not rendered (a collapsed section keeps them in the DOM) and the
 * unchecked radios of a group that already has a checked one.
 */
function tabStops(dialog: HTMLElement): HTMLElement[] {
  const checkedGroups = new Set(
    [...dialog.querySelectorAll<HTMLInputElement>('input[type="radio"]:checked')].map(
      (radio) => radio.name,
    ),
  );
  return [...dialog.querySelectorAll<HTMLElement>(TAB_STOPS)].filter(
    (el) =>
      !el.matches(":disabled") &&
      el.tabIndex >= 0 &&
      el.getClientRects().length > 0 &&
      !(
        el instanceof HTMLInputElement &&
        el.type === "radio" &&
        !el.checked &&
        checkedGroups.has(el.name)
      ),
  );
}

/**
 * Shared modal scaffold: overlay, card, header, Escape-to-close and focus
 * management (focus moves in on open, Tab stays inside, and it returns to
 * the trigger on close).
 *
 * Escape handling is load-bearing beyond keyboard users — the demo tour
 * closes whatever modal is open by dispatching a synthetic Escape keydown,
 * so every modal in the app must get its Escape behavior from here.
 */
export default function Modal(props: ModalProps) {
  const closeOnBackdrop = props.closeOnBackdrop !== false;
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        props.onClose();
      }
    }
    document.addEventListener("keydown", onKeydown);
    return () => {
      document.removeEventListener("keydown", onKeydown);
    };
  }, [props.onClose]);

  // Focus moves into the dialog on open and back to whatever had it on
  // close. Mount-scoped on purpose: the restore must not re-fire on every
  // parent re-render.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    // An `autoFocus` field has already pulled focus inside (React focuses it
    // as it commits); only step in while focus is still out on the page.
    if (dialog && !dialog.contains(document.activeElement)) dialog.focus();
    return () => previouslyFocused?.focus();
  }, []);

  /** Tab / Shift+Tab cycle inside the dialog instead of reaching the page behind it. */
  function keepTabInside(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab") return;
    const stops = tabStops(e.currentTarget);
    // -1: focus is on the dialog itself or on a child that is no tab stop.
    // Shift+Tab from there would step out — the portal sits at the end of
    // <body> — so it goes to the last stop; Tab back to the first.
    const i = stops.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey ? i <= 0 : i === -1 || i === stops.length - 1) {
      e.preventDefault();
      (e.shiftKey ? stops.at(-1) : stops.at(0))?.focus();
    }
  }

  // Portal to <body>: modals must escape any ancestor that hides or clips
  // content (the collapsed sidebar wraps EntityManager in opacity-0 h-0
  // overflow-hidden — an in-place fixed overlay there is invisible yet
  // still swallows every click on the page).
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        if (closeOnBackdrop) {
          props.onClose();
        } else {
          // The backdrop is not focusable, so this click just dropped focus
          // to <body>; put it back on the dialog so Tab stays inside.
          dialogRef.current?.focus();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof props.title === "string" ? props.title : undefined}
        tabIndex={-1}
        onKeyDown={keepTabInside}
        className={`animate-modal-in bg-surface border border-white/10 w-full ${
          props.widthClass ?? "max-w-md"
        } rounded-custom shadow-overlay flex flex-col overflow-hidden`}
      >
        <header className="px-4 py-3 sm:px-6 sm:py-4 border-b border-border-custom flex justify-between items-center gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-white">{props.title}</h2>
            {props.subtitle && <p className="text-sm text-zinc-400 mt-1">{props.subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={props.onClose}
            aria-label={props.closeLabel}
            className="text-zinc-400 hover:text-white transition-colors shrink-0"
          >
            <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                d="M6 18L18 6M6 6l12 12"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              />
            </svg>
          </button>
        </header>
        {props.children}
        {props.footer && (
          <footer className="px-4 py-3 sm:px-6 sm:py-4 border-t border-border-custom bg-white/5 flex justify-between items-center gap-3">
            {props.footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
