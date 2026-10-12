/**
 * English translation dictionary.
 *
 * Keys match lib/locales/es.ts exactly. Phase 1: auth, landing, dashboard core.
 */
export const en: Record<string, string> = {
  // --- Common ---
  "common.loading": "Loading...",
  "common.saving": "Saving...",
  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.delete": "Delete",
  "common.close": "Close",
  "common.create": "Create",
  "common.error_connection": "Connection error",
  "common.error_unknown": "Unknown error",
  "common.you_label": "(You)",
  "common.tercero_badge": "third-party",

  // --- App / page titles ---
  "app.name": "A la Par",
  "app.tagline":
    "The easiest way to split expenses with friends, family, or travel buddies.",

  // --- Landing page ---
  "landing.new_registry": "New group",
  "landing.new_registry_desc":
    "Create a new expense group for your next trip or event.",
  "landing.start": "Get started",
  "landing.join_registry": "Join a group",
  "landing.join_registry_desc":
    "Enter an invite code to join an existing group.",
  "landing.copyright": "© 2024 A la Par. Transparent finances.",

  // --- Auth ---
  "auth.login": "Log in",
  "auth.login_subtitle": "Sign in to your A la Par account",
  "auth.signup": "Sign up",
  "auth.signup_subtitle": "Create an account to start splitting expenses",
  "auth.forgot_password": "Reset password",
  "auth.forgot_password_subtitle":
    "Enter your email and we'll send you a link to reset it",
  "auth.reset_password": "New password",
  "auth.reset_password_subtitle": "Enter your new password",
  "auth.name": "Name",
  "auth.name_placeholder": "Your name",
  "auth.email": "Email",
  "auth.email_placeholder": "you@email.com",
  "auth.password": "Password",
  "auth.show_password": "Show password",
  "auth.hide_password": "Hide password",
  "auth.google": "Continue with Google",
  "auth.or": "or",
  "auth.forgot_link": "Forgot your password?",
  "auth.no_account": "Don't have an account?",
  "auth.signup_link": "Sign up",
  "auth.has_account": "Already have an account?",
  "auth.login_link": "Log in",
  "auth.check_email": "Check your email to confirm your account.",
  "auth.rate_limited":
    "Too many emails were sent recently. Please wait a few minutes and try again.",
  "auth.session_error": "Error saving session",

  // --- Forgot password ---
  "forgot.submit": "Send recovery link",
  "forgot.sending": "Sending...",
  "forgot.back_login": "Back to log in",
  "forgot.success":
    "We sent you an email with the link to reset your password.",

  // --- Reset password ---
  "reset.new_password": "New password",
  "reset.confirm_password": "Confirm password",
  "reset.submit": "Reset password",
  "reset.updating": "Updating...",
  "reset.success": "Your password was updated successfully.",
  "reset.invalid_link": "Invalid or expired recovery link. Request a new one.",
  "reset.session_failed":
    "Could not establish session. The link may have expired.",
  "reset.password_too_short": "Password must be at least 6 characters.",
  "reset.password_mismatch": "Passwords don't match.",
  "reset.request_new": "Request a new link",
  "reset.verifying": "Verifying link...",

  // --- Auth callback ---
  "auth_callback.title": "A la Par - Authenticating",
  "auth_callback.authenticating": "Authenticating...",
  "auth_callback.no_tokens": "No authentication tokens received.",
  "auth_callback.auth_failed": "Could not complete authentication.",
  "auth_callback.technical_details": "Technical details",
  "auth_callback.back_login": "Back to log in",

  // --- Balance ---
  "balance.total": "Total Balance",
  "balance.breakdown_title": "Breakdown by person",
  "balance.breakdown_subtitle": "Balance details with each member",
  "balance.all_settled": "Everyone is settled up",
  "balance.owed_to_you": "Owes you",
  "balance.you_owe": "You owe",

  // --- Transaction list ---
  "tx.current_period": "Current period",
  "tx.current_period_filtered": "Current period (paid by {name})",
  "tx.all": "All",
  "tx.search_placeholder": "Search transaction...",
  "tx.empty_title": "No transactions",
  "tx.empty_desc": "Add an expense or payment",
  "tx.no_results": "No transactions found with these filters.",
  "tx.clear_filters": "Clear filters",
  "tx.add_expense_mobile": "Expense",
  "tx.add_payment_mobile": "Payment",
  "tx.add_expense_tooltip": "Add expense",
  "tx.add_payment_tooltip": "Add payment",
  "tx.paid_by_you": "You paid",
  "tx.paid_by_other": "{name} paid",
  "tx.paid_to": "You paid {name}",
  "tx.received_from": "{name} paid you",
  "tx.of_total": "of {total}",
  "tx.notification_title": "New transaction",
  "tx.notification_body": "New transaction",
  "tx.badge_payment": "Payment",
  "tx.badge_adjustment": "Pending balance",
  "tx.badge_installment": "{current}/{total}",
  "tx.single_user_title": "It's lonely here",
  "tx.single_user_desc":
    "Make sure to invite other users or create a third-party",
  "tx.tercero_tooltip":
    "A third-party is an entity different from you that won't register as a user, for example: a bank!",

  // --- Transaction modal ---
  "modal.new_expense": "New Expense",
  "modal.edit_expense": "Edit Expense",
  "modal.new_expense_subtitle": "Configure how to split this expense.",
  "modal.edit_expense_subtitle": "Edit the expense details.",
  "modal.new_payment": "New Payment",
  "modal.edit_payment": "Edit Payment",
  "modal.new_payment_subtitle": "Register a payment between users.",
  "modal.edit_payment_subtitle": "Edit the payment details.",
  "modal.description": "Description",
  "modal.description_expense_placeholder": "e.g. Weekly groceries",
  "modal.description_payment_placeholder": "e.g. Balance payment",
  "modal.amount_total": "Total Amount",
  "modal.amount_payment": "Payment Amount",
  "modal.amount_installment": "Per-installment Amount",
  "modal.type": "Type",
  "type.unico": "One-time",
  "type.parcialidad": "Installment",
  "type.recurrente": "Recurring",
  "modal.installment_mode_total": "Total Amount",
  "modal.installment_mode_per": "Per-installment Amount",
  "modal.installment_current": "Current Installment",
  "modal.installment_of": "of",
  "modal.installment_months": "months",
  "modal.installment_count": "{n} installments",
  "modal.payer": "Paid by",
  "modal.notes": "Notes (optional)",
  "modal.notes_placeholder": "Additional notes...",
  "modal.pay_debt": "The {amount} owed",
  "modal.transfer_section": "Transfer",
  "modal.user_header": "USER",
  "modal.paid_header": "Paid",
  "modal.received_header": "Received",
  "modal.balance_header": "BALANCE",
  "modal.owes_you": "Owes you {amount}",
  "modal.you_owe_them": "You owe {amount}",
  "modal.link_expenses": "Link this payment to existing expenses",
  "modal.link_expenses_tooltip":
    "You can only link payments when you have a balance to pay!",
  "modal.search_expense": "Search expense...",
  "modal.no_expenses_found": "No expenses found.",
  "modal.paid_by_name": "Paid by {name}",
  "modal.allocation_fully_covered": "Fully covered",
  "modal.allocation_partial": "Covering {covered} of {total}",
  "modal.allocation_unassigned": "Unassigned",
  "modal.allocation_expense": "Expense",
  "modal.allocation_section": "Allocation",
  "modal.split_section": "Split",
  "modal.split_auto": "Auto",
  "modal.split_percentage": "Percentage",
  "modal.split_fixed": "Fixed Amount",
  "modal.amount_header": "AMOUNT",
  "modal.total_header": "TOTAL",
  "modal.delete_confirm": "Delete this transaction?",
  "modal.save_error": "The transaction couldn't be saved.",
  "modal.delete_error": "The transaction couldn't be deleted.",
  "modal.unknown_payer": "Unknown",
  "modal.default_payment_desc": "Payment",

  // --- Registries ---
  "registry.new": "New Group",
  "registry.new_desc": "Create a group to manage shared expenses",
  "registry.name_label": "Group Name",
  "registry.name_placeholder": "e.g. Roommates",
  "registry.create": "Create Group",

  // --- Join ---
  "join.not_found": "Invitation not found",
  "join.not_found_desc": "The code {code} is not valid or has expired.",
  "join.go_home": "Go home",
  "join.join_registry": "Join {name}",
  "join.invited_desc": "You've been invited to a shared expense group.",
  "join.expired": "This invitation has expired.",
  "join.revoked": "This invitation has been revoked.",
  "join.max_uses": "This invitation has reached the maximum uses.",
  "join.login_to_join": "Log in to Join",
  "join.create_account": "Create Account",
  "join.joining": "Joining...",
  "join.join_button": "Join Group",
  "join.code_placeholder": "Code (e.g. K9X2M4B7)",

  // --- Billing / Pro tier ---
  "billing.upgrade": "Upgrade to Pro",
  "billing.pro_badge": "PRO",
  "billing.grandfathered_badge": "PRO",
  "billing.upgrade_hint_owner":
    "Unlock unlimited members and templates, plus full history.",
  "billing.group_full":
    "This group reached the free plan's member limit. The owner can upgrade to Pro to invite more people.",
  "billing.templates_full":
    "This group reached the free plan's recurring-template limit. The owner can upgrade to Pro to add more.",
  "billing.registries_full":
    "You reached the free plan's limit of 2 groups. Upgrade one to Pro or delete a group to create another.",
  "billing.history_locked": "Older cuts available in Pro",
  "billing.history_locked_cta": "Unlock full history",
  "billing.monthly": "Monthly",
  "billing.yearly": "Yearly",
  "billing.manage": "Manage subscription",
  "billing.success_title": "Pro activated!",
  "billing.success_desc":
    "Your group now has unlimited access. Every member benefits.",
  "billing.success_pending_title": "Processing payment…",
  "billing.success_pending_desc":
    "Your payment is being confirmed. This can take a few seconds; Pro will activate automatically.",
  "billing.back_to_dashboard": "Back to dashboard",
  "billing.view_plans": "See plans",

  "pricing.title": "Pricing",
  "pricing.subtitle": "Start free. Upgrade your group when it grows.",
  "pricing.free_name": "Free",
  "pricing.free_registries": "Up to {n} owned groups",
  "pricing.free_members": "Up to {n} members per group",
  "pricing.free_templates": "Up to {n} recurring templates",
  "pricing.free_history": "Latest cut in history",
  "pricing.unlimited_core":
    "Unlimited transactions, payments and cuts from day one",
  "pricing.pro_name": "Pro",
  "pricing.pro_includes": "Everything in the free plan, plus:",
  "pricing.pro_members": "Unlimited members per group",
  "pricing.pro_templates": "Unlimited recurring templates",
  "pricing.pro_history": "Full cut history",
  "pricing.pro_registries": "Unlimited owned groups",
  "pricing.per_month": "/mo",
  "pricing.per_year": "/yr",
  "pricing.subscribe": "Subscribe",
  "pricing.have_account": "Already have an account? Log in",
  "pricing.choose_registry": "Choose the group to upgrade:",
  "pricing.active_badge": "Active",
  "pricing.active_until": "Active until {date}",
  "pricing.cancel_scheduled": "Canceled — active until {date}",
  "pricing.grandfathered_note": "Early adopter: Pro forever",
  "pro.crown_sub": "Pro — manage subscription",
  "pro.crown_founding": "Pro — founding member (forever)",
  "pricing.cancel_link": "Cancel subscription",
  "pricing.cancel_title": "Cancel subscription",
  "pricing.cancel_body":
    "Your subscription stays active until {date}. After that, any group without another Pro member goes back to the free plan — nobody loses data, only the limits apply.",
  "pricing.cancel_confirm": "Yes, cancel",
  "pricing.keep_sub": "Keep subscription",
  "pricing.reactivate": "Reactivate",
  "pricing.create_first": "Create your first group",
  "pricing.create_first_hint":
    "Pro is purchased per group — create yours to get started.",

  // --- Billing: already-subscribed guard + plan switch ---
  "billing.already_subscribed":
    "You already have an active subscription — it covers every group you're in. To change plans, use the switch option below.",
  "billing.switch_to_yearly": "Switch to yearly",
  "billing.switch_to_monthly": "Switch to monthly",
  "billing.switch_title": "Switch plan?",
  "billing.switch_body":
    "Switch to the {plan} plan? The change applies to your current subscription and is prorated — you only pay (or get credited) the difference for the remaining time.",
  "billing.switch_confirm": "Switch plan",
  "billing.switch_keep": "Keep current plan",
  "billing.switch_error":
    "The plan change failed. Try again, or manage your subscription from the portal.",

  // --- Demo tour (driver.js) ---
  "tour.button_title": "Guided tour",
  "tour.next": "Next →",
  "tour.prev": "← Back",
  "tour.done": "Done ✓",
  "tour.menu_title": "🎓 Guided Tour",
  "tour.menu_desc": "Learn A la Par's features in a few minutes.",
  "tour.quick_title": "Quick Tour",
  "tour.quick_sub": "The essentials in 5 steps",
  "tour.full_title": "Full Tour",
  "tour.full_sub": "Includes the expense and payment dialogs",
  "tour.balance_title": "💰 Total Balance",
  "tour.balance_desc":
    "This is your net balance. Green = you're owed, red = you owe. Click it for a detailed per-person breakdown.",
  "tour.search_title": "🔍 Search & Filter",
  "tour.search_desc":
    "Search transactions by name or filter by person with the buttons above.",
  "tour.transactions_title": "📋 Transactions",
  "tour.transactions_desc":
    "All the expenses and payments in the current registry, sorted by date.",
  "tour.transactions_full_desc":
    "Every expense and payment in the registry. Each card shows who paid and how it was split.",
  "tour.add_expense_title": "➕ Add Expense",
  "tour.add_expense_desc":
    "Use this button to log an expense. Split it evenly, by percentage, or with fixed amounts.",
  "tour.add_expense_full_desc":
    "Let's open the form to create an expense and see the available options.",
  "tour.add_payment_title": "💸 Add Payment",
  "tour.add_payment_desc":
    "Use this button to record a payment between people and settle debts.",
  "tour.edit_title": "✏️ Edit Transactions",
  "tour.edit_desc":
    "Click any transaction to see its details, edit it, or delete it.",
  "tour.expense_type_title": "🏷️ Expense Type",
  "tour.expense_type_desc":
    "Choose the type: One-time (single payment), Installment (paid in parts, e.g. a laptop over months), or Recurring (repeats every period, e.g. rent).",
  "tour.split_mode_title": "🔀 Split Mode",
  "tour.split_mode_desc":
    "Decide how to split the expense: Automatic (equal parts), Percentage (e.g. 60%/40%), or Fixed Amount (specific amounts per person).",
  "tour.pay_debt_title": "✅ Settle Debt",
  "tour.pay_debt_desc":
    "When someone owes you, this button computes the exact amount automatically. One click and the payment is recorded for the right amount.",
  "tour.finale_title": "🎉 That's it!",
  "tour.finale_desc":
    "You now know A la Par's main features. Explore the demo freely — all changes are temporary and reset on reload.",
};
