import { type ComponentChildren } from "preact";
import { useEffect } from "preact/hooks";

interface ModalProps {
  onClose: () => void;
  title: ComponentChildren;
  subtitle?: ComponentChildren;
  /** Tailwind max-width class for the card. Default `max-w-md`. */
  widthClass?: string;
  /**
   * Whether clicking the backdrop closes the modal. Default true; form-heavy
   * modals (the transaction editor) opt out so an accidental click can't
   * discard a half-filled form.
   */
  closeOnBackdrop?: boolean;
  children: ComponentChildren;
  footer?: ComponentChildren;
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
      class="fixed inset-0 z-50 flex items-center justify-center p-4 modal-overlay"
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
        tabindex={-1}
        class={`bg-surface border border-border-custom w-full ${
          props.widthClass ?? "max-w-md"
        } rounded-custom shadow-2xl flex flex-col overflow-hidden`}
      >
        <header class="px-4 py-3 sm:px-6 sm:py-4 border-b border-border-custom flex justify-between items-center gap-3">
          <div class="min-w-0">
            <h2 class="text-xl font-bold text-white">{props.title}</h2>
            {props.subtitle && (
              <p class="text-sm text-zinc-400 mt-1">{props.subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={props.onClose}
            aria-label={props.closeLabel ?? "Cerrar"}
            class="text-zinc-400 hover:text-white transition-colors shrink-0"
          >
            <svg
              class="h-6 w-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                d="M6 18L18 6M6 6l12 12"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
              />
            </svg>
          </button>
        </header>
        {props.children}
        {props.footer && (
          <footer class="px-4 py-3 sm:px-6 sm:py-4 border-t border-border-custom bg-white/5 flex justify-between items-center gap-3">
            {props.footer}
          </footer>
        )}
      </div>
    </div>
  );
}
