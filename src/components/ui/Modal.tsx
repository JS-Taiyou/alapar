import { useEffect, type ReactNode } from "react";

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
   * Accessible label for the × button. Defaults to Spanish ("Cerrar") to
   * match the pre-i18n callers; localized callers pass t(locale, "common.close").
   */
  closeLabel?: string;
}

/**
 * Shared modal scaffold: overlay, card, header, Escape-to-close.
 *
 * Escape handling is load-bearing beyond keyboard users — the demo tour
 * closes whatever modal is open by dispatching a synthetic Escape keydown,
 * so every modal in the app must get its Escape behavior from here.
 */
export default function Modal(props: ModalProps) {
  const closeOnBackdrop = props.closeOnBackdrop !== false;

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 modal-overlay"
      role="presentation"
      onClick={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) {
          props.onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof props.title === "string" ? props.title : undefined}
        tabIndex={-1}
        className={`bg-surface border border-border-custom w-full ${
          props.widthClass ?? "max-w-md"
        } rounded-custom shadow-2xl flex flex-col overflow-hidden`}
      >
        <header className="px-4 py-3 sm:px-6 sm:py-4 border-b border-border-custom flex justify-between items-center gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-white">{props.title}</h2>
            {props.subtitle && <p className="text-sm text-zinc-400 mt-1">{props.subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={props.onClose}
            aria-label={props.closeLabel ?? "Cerrar"}
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
    </div>
  );
}
