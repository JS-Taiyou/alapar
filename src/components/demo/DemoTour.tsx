import { useEffect, useState } from "react";
import { driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import { type Locale, tt } from "../../lib/i18n";
import { useIsStandalone } from "../dashboard/Sidebar";

/**
 * Guided tour island for the /demo page, powered by driver.js (MIT, zero deps).
 *
 * Offers two tours the user can choose from via a floating button (a bottom
 * corner of the content column, clear of the sidebar and the FABs):
 *
 * - **Quick Tour** (6 steps): main-page highlights only.
 * - **Full Tour** (9 steps): main page + modal walkthrough (type selector,
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

export default function DemoTour(props: DemoTourProps) {
  const t = tt(props.locale ?? "es");
  const [showMenu, setShowMenu] = useState(false);
  const [tourActive, setTourActive] = useState(false);
  const installed = useIsStandalone();

  useEffect(() => {
    // Auto-prompt on first visit (only if never seen).
    const seen = localStorage.getItem("demo-tour-seen");
    if (!seen) {
      // Small delay so the page finishes rendering.
      const timer = setTimeout(() => setShowMenu(true), 800);
      return () => clearTimeout(timer);
    }
  }, []);

  /**
   * The first on-screen element among `selectors`. Desktop and mobile often
   * render the same control twice (the FABs; the sidebar vs its hamburger
   * button), so callers list both and this picks the visible one.
   */
  function visibleAnchor(...selectors: string[]): Element {
    const found = selectors.map((selector) => document.querySelector(selector));
    return (
      found.find((el) => el?.checkVisibility?.()) ??
      // Fallback: offsetParent is non-null for visible elements.
      found.find((el) => (el as HTMLElement | null)?.offsetParent !== null) ??
      found.find((el) => el !== null) ??
      document.body
    );
  }

  /**
   * Find the visible add-expense or add-payment button. On desktop the FABs
   * carry data-tour="add-expense"/"add-payment"; on mobile the inline buttons
   * carry the "-mobile" suffix.
   */
  function visibleFab(base: "add-expense" | "add-payment"): Element {
    return visibleAnchor(`[data-tour="${base}"]`, `[data-tour="${base}-mobile"]`);
  }

  /**
   * The books step: the sidebar's book list on desktop, the menu button on
   * mobile — up in the header for most books, floating near the bottom for a
   * one-member book. The popover side is decided here from where the anchor
   * sits when the tour starts; fine, because every tour opens with this step.
   *
   * The installed PWA on a phone shows no menu button (a swipe opens the
   * drawer), so there is nothing to point at: the step has no anchor, which
   * makes driver.js center a popover that highlights nothing, and its copy
   * says how to reach the books instead.
   */
  function booksStep(): DriveStep {
    if (installed && globalThis.innerWidth < 768) {
      return {
        popover: { title: t("tour.books_title"), description: t("tour.books_desc_swipe") },
      };
    }
    const anchor = visibleAnchor('[data-tour="sidebar-books"]', '[data-tour="sidebar-open"]');
    const popoverBelow = anchor.getBoundingClientRect().top < globalThis.innerHeight / 2;
    return {
      element: () => visibleAnchor('[data-tour="sidebar-books"]', '[data-tour="sidebar-open"]'),
      popover: {
        title: t("tour.books_title"),
        description: t("tour.books_desc"),
        side: globalThis.innerWidth >= 768 ? "right" : popoverBelow ? "bottom" : "top",
        align: "start",
      },
    };
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
      // Wait for React to render the modal.
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  }

  function startQuickTour() {
    setShowMenu(false);
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
        booksStep(),
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
    setShowMenu(false);
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
        booksStep(),
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
      {/* Floating tour button. Bottom-right on phones (no FABs there, and the
          menu button is up in the header); bottom-left from sm up, riding
          above the floating menu button a one-member book still gets, and in
          the corner from md up, beside the sidebar. It stays below the mobile
          drawer's layers (z-40 backdrop, z-50 panel) so an open menu covers it
          like any other content. */}
      <button
        type="button"
        onClick={() => setShowMenu(!showMenu)}
        className="absolute bottom-8 right-4 sm:bottom-36 sm:left-4 sm:right-auto md:bottom-8 md:left-8 z-30 w-14 h-14 bg-primary hover:bg-primary-light text-white rounded-full shadow-2xl flex items-center justify-center transition-all hover:scale-110 active:scale-95"
        title={t("tour.button_title")}
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          />
        </svg>
      </button>

      {/* Tour selection menu */}
      {showMenu && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
          {/* Menu card: above its own backdrop, below the mobile drawer */}
          <div className="absolute bottom-24 right-4 sm:bottom-52 sm:left-4 sm:right-auto md:bottom-24 md:left-8 z-40 bg-surface border border-border-custom rounded-custom shadow-2xl p-4 w-72 animate-fade-up">
            <h3 className="text-sm font-bold text-zinc-200 mb-3">{t("tour.menu_title")}</h3>
            <p className="text-xs text-zinc-400 mb-4">{t("tour.menu_desc")}</p>
            <button
              type="button"
              onClick={startQuickTour}
              className="w-full mb-2 px-4 py-3 bg-primary hover:bg-primary-light text-white text-sm font-semibold rounded-custom transition-all active:scale-95 text-left"
            >
              <span className="block font-bold">{t("tour.quick_title")}</span>
              <span className="block text-xs opacity-80 mt-0.5">{t("tour.quick_sub")}</span>
            </button>
            <button
              type="button"
              onClick={startFullTour}
              className="w-full px-4 py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-white text-sm font-semibold rounded-custom transition-all active:scale-95 text-left"
            >
              <span className="block font-bold">{t("tour.full_title")}</span>
              <span className="block text-xs opacity-60 mt-0.5">{t("tour.full_sub")}</span>
            </button>
          </div>
        </>
      )}
    </>
  );
}
