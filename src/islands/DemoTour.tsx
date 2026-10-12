import { useEffect, useState } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import { type Locale, tt } from "../lib/i18n";

/**
 * Guided tour island for the /demo page, powered by driver.js (MIT, zero deps).
 *
 * Offers two tours the user can choose from via a floating button (bottom-left,
 * so it doesn't clash with the FABs at bottom-right):
 *
 * - **Quick Tour** (5 steps): main-page highlights only.
 * - **Full Tour** (10 steps): main page + modal walkthrough (type selector,
 *   split modes, pay-exact-debt button).
 *
 * The deep-dive tour programmatically opens the modal by clicking the FABs,
 * waits for the DOM to render, highlights the internal elements, then closes
 * the modal via Escape before continuing. This coordination is handled via
 * driver.js per-step lifecycle hooks (`onPopoverRender`, `onDestroyStarted`).
 *
 * A `localStorage` flag suppresses auto-prompt after the first visit, but the
 * floating button is always visible so users can replay.
 *
 * All copy lives in lib/locales/{en,es}.ts under `tour.*`; the locale prop
 * comes from the server-resolved `alapar-locale` cookie like every island.
 */

interface DemoTourProps {
  locale?: Locale;
}

// driver.js is client-side only; lazy-import inside useEffect to avoid SSR.
export default function DemoTour(props: DemoTourProps) {
  const t = tt(props.locale ?? "es");
  const showMenu = useSignal(false);
  const [tourActive, setTourActive] = useState(false);

  useEffect(() => {
    // Auto-prompt on first visit (only if never seen).
    const seen = localStorage.getItem("demo-tour-seen");
    if (!seen) {
      // Small delay so the page finishes rendering.
      const timer = setTimeout(() => (showMenu.value = true), 800);
      return () => clearTimeout(timer);
    }
  }, []);

  /**
   * Find the visible add-expense or add-payment button. On desktop the FABs
   * carry data-tour="add-expense"/"add-payment"; on mobile the inline buttons
   * carry the "-mobile" suffix. Return whichever is currently displayed.
   */
  function visibleFab(base: "add-expense" | "add-payment"): Element {
    const desktop = document.querySelector(`[data-tour="${base}"]`);
    if (desktop && desktop.checkVisibility?.()) return desktop;
    const mobile = document.querySelector(`[data-tour="${base}-mobile"]`);
    if (mobile && mobile.checkVisibility?.()) return mobile;
    // Fallback: offsetParent is non-null for visible elements.
    const all = document.querySelectorAll(`[data-tour="${base}"], [data-tour="${base}-mobile"]`);
    for (const el of all) {
      if ((el as HTMLElement).offsetParent !== null) return el;
    }
    return desktop ?? mobile ?? document.body;
  }

  function markSeen() {
    localStorage.setItem("demo-tour-seen", "true");
  }

  function closeModals() {
    // Close any open modal by pressing Escape (the modal listens for it).
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  }

  function openModal(base: "add-expense" | "add-payment"): Promise<void> {
    return new Promise((resolve) => {
      const fab = visibleFab(base) as HTMLElement | null;
      fab?.click();
      // Wait for Preact to render the modal.
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  }

  function startQuickTour() {
    showMenu.value = false;
    setTourActive(true);
    markSeen();

    const driverObj = driver({
      showProgress: true,
      onDestroyed: () => setTourActive(false),
      nextBtnText: t("tour.next"),
      prevBtnText: t("tour.prev"),
      doneBtnText: t("tour.done"),
      popoverClass: "alapar-popover",
      steps: [
        {
          element: '[data-tour="balance-total"]',
          popover: {
            title: t("tour.balance_title"),
            description: t("tour.balance_desc"),
            side: "bottom",
            align: "start",
          },
        },
        {
          element: '[data-tour="transaction-list"]',
          popover: {
            title: t("tour.transactions_title"),
            description: t("tour.transactions_desc"),
            side: "top",
            align: "center",
          },
        },
        {
          element: () => visibleFab("add-expense"),
          popover: {
            title: t("tour.add_expense_title"),
            description: t("tour.add_expense_desc"),
            side: "left",
            align: "center",
          },
        },
        {
          element: () => visibleFab("add-payment"),
          popover: {
            title: t("tour.add_payment_title"),
            description: t("tour.add_payment_desc"),
            side: "left",
            align: "center",
          },
        },
        {
          element: '[data-tour="transaction-card"]',
          popover: {
            title: t("tour.edit_title"),
            description: t("tour.edit_desc"),
            side: "top",
            align: "center",
          },
        },
      ],
    });

    driverObj.drive();
  }

  function startFullTour() {
    showMenu.value = false;
    setTourActive(true);
    markSeen();

    const driverObj = driver({
      showProgress: true,
      onDestroyed: () => {
        closeModals();
        setTourActive(false);
      },
      nextBtnText: t("tour.next"),
      prevBtnText: t("tour.prev"),
      doneBtnText: t("tour.done"),
      popoverClass: "alapar-popover",
      steps: [
        // --- Main page (same as quick tour) ---
        {
          element: '[data-tour="balance-total"]',
          popover: {
            title: t("tour.balance_title"),
            description: t("tour.balance_desc"),
            side: "bottom",
            align: "start",
          },
        },
        {
          element: '[data-tour="search-bar"]',
          popover: {
            title: t("tour.search_title"),
            description: t("tour.search_desc"),
            side: "bottom",
            align: "center",
          },
        },
        {
          element: '[data-tour="transaction-list"]',
          popover: {
            title: t("tour.transactions_title"),
            description: t("tour.transactions_full_desc"),
            side: "top",
            align: "center",
          },
        },
        {
          element: () => visibleFab("add-expense"),
          popover: {
            title: t("tour.add_expense_title"),
            description: t("tour.add_expense_full_desc"),
            side: "left",
            align: "center",
            onNextClick: async () => {
              await openModal("add-expense");
              driverObj.moveNext();
            },
          },
        },
        // --- Inside expense modal ---
        {
          element: '[data-tour="expense-type"]',
          popover: {
            title: t("tour.expense_type_title"),
            description: t("tour.expense_type_desc"),
            side: "bottom",
            align: "center",
          },
        },
        {
          element: '[data-tour="split-mode"]',
          popover: {
            title: t("tour.split_mode_title"),
            description: t("tour.split_mode_desc"),
            side: "bottom",
            align: "end",
            onPrevClick: () => driverObj.movePrevious(),
            onNextClick: () => {
              closeModals();
              setTimeout(() => {
                openModal("add-payment").then(() => driverObj.moveNext());
              }, 200);
            },
          },
        },
        // --- Inside payment modal ---
        {
          element: '[data-tour="pay-debt"]',
          popover: {
            title: t("tour.pay_debt_title"),
            description: t("tour.pay_debt_desc"),
            side: "bottom",
            align: "center",
            onPrevClick: async () => {
              closeModals();
              await openModal("add-expense");
              driverObj.movePrevious();
            },
          },
        },
        {
          popover: {
            title: t("tour.finale_title"),
            description: t("tour.finale_desc"),
            side: "top",
            align: "center",
            onDoneClick: () => {
              closeModals();
              driverObj.destroy();
              setTourActive(false);
            },
          },
        },
      ],
    });

    driverObj.drive();
  }

  if (tourActive) return null;

  return (
    <>
      {/* Floating tour button */}
      <button
        type="button"
        onClick={() => (showMenu.value = !showMenu.value)}
        class="fixed bottom-8 left-8 z-50 w-14 h-14 bg-primary hover:bg-primary-light text-white rounded-full shadow-2xl flex items-center justify-center transition-all hover:scale-110 active:scale-95"
        title={t("tour.button_title")}
      >
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
          />
        </svg>
      </button>

      {/* Tour selection menu */}
      {showMenu.value && (
        <>
          {/* Backdrop */}
          <div class="fixed inset-0 z-40" onClick={() => (showMenu.value = false)} />
          {/* Menu card */}
          <div class="fixed bottom-24 left-8 z-50 bg-surface border border-border-custom rounded-custom shadow-2xl p-4 w-72 animate-fade-up">
            <h3 class="text-sm font-bold text-zinc-200 mb-3">{t("tour.menu_title")}</h3>
            <p class="text-xs text-zinc-400 mb-4">{t("tour.menu_desc")}</p>
            <button
              type="button"
              onClick={startQuickTour}
              class="w-full mb-2 px-4 py-3 bg-primary hover:bg-primary-light text-white text-sm font-semibold rounded-custom transition-all active:scale-95 text-left"
            >
              <span class="block font-bold">{t("tour.quick_title")}</span>
              <span class="block text-xs opacity-80 mt-0.5">{t("tour.quick_sub")}</span>
            </button>
            <button
              type="button"
              onClick={startFullTour}
              class="w-full px-4 py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-sm font-semibold rounded-custom transition-all active:scale-95 text-left"
            >
              <span class="block font-bold">{t("tour.full_title")}</span>
              <span class="block text-xs opacity-60 mt-0.5">{t("tour.full_sub")}</span>
            </button>
          </div>
        </>
      )}
    </>
  );
}
