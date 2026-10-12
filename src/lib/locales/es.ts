/**
 * Spanish (default) translation dictionary.
 *
 * Keys follow the convention: `screen.element` or `category.concept`.
 * Interpolation placeholders use `{name}` syntax.
 *
 * Phase 1: auth screens, landing page, dashboard core.
 * Phase 2 keys will be appended in a follow-up.
 */
export const es: Record<string, string> = {
  // --- Common ---
  "common.loading": "Cargando...",
  "common.saving": "Guardando...",
  "common.save": "Guardar",
  "common.cancel": "Cancelar",
  "common.delete": "Eliminar",
  "common.close": "Cerrar",
  "common.create": "Crear",
  "common.error_connection": "Error de conexión",
  "common.error_unknown": "Error desconocido",
  "common.you_label": "(Tú)",
  "common.tercero_badge": "tercero",

  // --- App / page titles ---
  "app.name": "A la par",
  "app.tagline":
    "La forma más sencilla de dividir gastos con amigos, familiares o compañeros de viaje.",

  // --- Landing page ---
  "landing.new_registry": "Nuevo registro",
  "landing.new_registry_desc":
    "Crea un nuevo grupo de gastos para tu próximo viaje o evento.",
  "landing.start": "Comenzar",
  "landing.join_registry": "Unirme a registro",
  "landing.join_registry_desc":
    "Introduce un código de invitación para unirte a un grupo existente.",
  "landing.copyright": "© 2024 A la par. Finanzas transparentes.",

  // --- Auth ---
  "auth.login": "Iniciar Sesión",
  "auth.login_subtitle": "Ingresa a tu cuenta de A la par",
  "auth.signup": "Crear Cuenta",
  "auth.signup_subtitle": "Regístrate para empezar a dividir gastos",
  "auth.forgot_password": "Recuperar Contraseña",
  "auth.forgot_password_subtitle":
    "Ingresa tu email y te enviaremos un enlace para restablecerla",
  "auth.reset_password": "Nueva Contraseña",
  "auth.reset_password_subtitle": "Ingresa tu nueva contraseña",
  "auth.name": "Nombre",
  "auth.name_placeholder": "Tu nombre",
  "auth.email": "Email",
  "auth.email_placeholder": "tu@email.com",
  "auth.password": "Contraseña",
  "auth.show_password": "Mostrar contraseña",
  "auth.hide_password": "Ocultar contraseña",
  "auth.google": "Continuar con Google",
  "auth.or": "o",
  "auth.forgot_link": "Olvidaste tu contraseña?",
  "auth.no_account": "No tienes cuenta?",
  "auth.signup_link": "Regístrate",
  "auth.has_account": "Ya tienes cuenta?",
  "auth.login_link": "Inicia sesión",
  "auth.check_email": "Revisa tu email para confirmar tu cuenta.",
  "auth.rate_limited":
    "Se han enviado demasiados correos recientemente. Espera unos minutos e inténtalo de nuevo.",
  "auth.session_error": "Error al guardar la sesión",

  // --- Forgot password ---
  "forgot.submit": "Enviar enlace de recuperación",
  "forgot.sending": "Enviando...",
  "forgot.back_login": "Volver a iniciar sesión",
  "forgot.success":
    "Te enviamos un email con el enlace para restablecer tu contraseña.",

  // --- Reset password ---
  "reset.new_password": "Nueva contraseña",
  "reset.confirm_password": "Confirmar contraseña",
  "reset.submit": "Restablecer contraseña",
  "reset.updating": "Actualizando...",
  "reset.success": "Tu contraseña fue actualizada correctamente.",
  "reset.invalid_link":
    "Enlace de recuperación inválido o expirado. Solicita uno nuevo.",
  "reset.session_failed":
    "No se pudo establecer la sesión. El enlace puede haber expirado.",
  "reset.password_too_short": "La contraseña debe tener al menos 6 caracteres.",
  "reset.password_mismatch": "Las contraseñas no coinciden.",
  "reset.request_new": "Solicitar un nuevo enlace",
  "reset.verifying": "Verificando enlace...",

  // --- Auth callback ---
  "auth_callback.title": "A la par - Autenticando",
  "auth_callback.authenticating": "Autenticando...",
  "auth_callback.no_tokens": "No se recibieron tokens de autenticación.",
  "auth_callback.auth_failed": "No se pudo completar la autenticación.",
  "auth_callback.technical_details": "Detalles técnicos",
  "auth_callback.back_login": "Volver a iniciar sesión",

  // --- Balance ---
  "balance.total": "Balance Total",
  "balance.breakdown_title": "Desglose por persona",
  "balance.breakdown_subtitle": "Detalle de saldos con cada miembro",
  "balance.all_settled": "Todos están balanceados",
  "balance.owed_to_you": "Te deben",
  "balance.you_owe": "Debes",

  // --- Transaction list ---
  "tx.current_period": "Ejercicio actual",
  "tx.current_period_filtered": "Ejercicio actual (pagados por {name})",
  "tx.all": "Todos",
  "tx.search_placeholder": "Buscar transacción...",
  "tx.empty_title": "Sin transacciones",
  "tx.empty_desc": "Agrega un gasto o un pago",
  "tx.no_results": "No se encontraron transacciones con estos filtros.",
  "tx.clear_filters": "Limpiar filtros",
  "tx.add_expense_mobile": "Gasto",
  "tx.add_payment_mobile": "Pago",
  "tx.add_expense_tooltip": "Agregar gasto",
  "tx.add_payment_tooltip": "Agregar pago",
  "tx.paid_by_you": "Tú pagaste",
  "tx.paid_by_other": "{name} pagó",
  "tx.paid_to": "Le pagaste a {name}",
  "tx.received_from": "Te pagó {name}",
  "tx.of_total": "de {total}",
  "tx.notification_title": "Nueva transacción",
  "tx.notification_body": "Nueva transacción",
  "tx.badge_payment": "Pago",
  "tx.badge_adjustment": "Saldo pendiente",
  "tx.badge_installment": "{current}/{total}",
  "tx.single_user_title": "Está muy solo aquí",
  "tx.single_user_desc":
    "Asegúrate de invitar otros usuarios o crear un tercero",
  "tx.tercero_tooltip":
    "Un tercero es una entidad diferente de ti pero que no se va a registrar como usuario, por ejemplo: un banco!",

  // --- Transaction modal ---
  "modal.new_expense": "Nuevo Gasto",
  "modal.edit_expense": "Editar Gasto",
  "modal.new_expense_subtitle": "Configura cómo se divide este gasto.",
  "modal.edit_expense_subtitle": "Modifica los detalles del gasto.",
  "modal.new_payment": "Nuevo Pago",
  "modal.edit_payment": "Editar Pago",
  "modal.new_payment_subtitle": "Registra un pago entre usuarios.",
  "modal.edit_payment_subtitle": "Modifica los detalles del pago.",
  "modal.description": "Descripción",
  "modal.description_expense_placeholder": "Ej: Supermercado semanal",
  "modal.description_payment_placeholder": "Ej: Pago de balance",
  "modal.amount_total": "Monto Total",
  "modal.amount_payment": "Monto del Pago",
  "modal.amount_installment": "Monto por Parcialidad",
  "modal.type": "Tipo",
  "type.unico": "Único",
  "type.parcialidad": "Parcialidad",
  "type.recurrente": "Recurrente",
  "modal.installment_mode_total": "Monto Total",
  "modal.installment_mode_per": "Monto por Parcialidad",
  "modal.installment_current": "Parcialidad Actual",
  "modal.installment_of": "de",
  "modal.installment_months": "meses",
  "modal.installment_count": "{n} parcialidades",
  "modal.payer": "Pagó",
  "modal.notes": "Notas (opcional)",
  "modal.notes_placeholder": "Notas adicionales...",
  "modal.pay_debt": "Los {amount} pendientes",
  "modal.transfer_section": "Transferencia",
  "modal.user_header": "USUARIO",
  "modal.paid_header": "Pagó",
  "modal.received_header": "Recibió",
  "modal.balance_header": "SALDO",
  "modal.owes_you": "Te debe {amount}",
  "modal.you_owe_them": "Le debes {amount}",
  "modal.link_expenses": "Relacionar este pago a gastos existentes",
  "modal.link_expenses_tooltip":
    "Sólo puedes relacionar pagos cuando tienes saldo por pagar!",
  "modal.search_expense": "Buscar gasto...",
  "modal.no_expenses_found": "No se encontraron gastos.",
  "modal.paid_by_name": "Pagó {name}",
  "modal.allocation_fully_covered": "Completamente cubierto",
  "modal.allocation_partial": "Cubriendo {covered} de {total}",
  "modal.allocation_unassigned": "Sin asignar",
  "modal.allocation_expense": "Gasto",
  "modal.allocation_section": "Distribución",
  "modal.split_section": "División",
  "modal.split_auto": "Auto",
  "modal.split_percentage": "Porcentaje",
  "modal.split_fixed": "Monto Fijo",
  "modal.amount_header": "MONTO",
  "modal.total_header": "TOTAL",
  "modal.delete_confirm": "Eliminar esta transacción?",
  "modal.save_error": "No se pudo guardar la transacción.",
  "modal.delete_error": "No se pudo eliminar la transacción.",
  "modal.unknown_payer": "Desconocido",
  "modal.default_payment_desc": "Pago",

  // --- Registries ---
  "registry.new": "Nuevo Registro",
  "registry.new_desc": "Crea un grupo para gestionar gastos compartidos",
  "registry.name_label": "Nombre del Registro",
  "registry.name_placeholder": "Ej: Compañeros de piso",
  "registry.create": "Crear Registro",

  // --- Join ---
  "join.not_found": "Invitación no encontrada",
  "join.not_found_desc": "El código {code} no es válido o ha expirado.",
  "join.go_home": "Ir al inicio",
  "join.join_registry": "Unirse a {name}",
  "join.invited_desc": "Has sido invitado a un grupo de gastos compartidos.",
  "join.expired": "Esta invitación ha expirado.",
  "join.revoked": "Esta invitación ha sido revocada.",
  "join.max_uses": "Esta invitación ha alcanzado el máximo de usos.",
  "join.login_to_join": "Iniciar Sesión para Unirme",
  "join.create_account": "Crear Cuenta",
  "join.joining": "Uniéndote...",
  "join.join_button": "Unirme al Registro",
  "join.code_placeholder": "Código (ej: K9X2M4B7)",

  // --- Billing / Pro tier ---
  "billing.upgrade": "Mejorar a Pro",
  "billing.pro_badge": "PRO",
  "billing.grandfathered_badge": "PRO",
  "billing.upgrade_hint_owner":
    "Desbloquea miembros y plantillas ilimitadas, e historial completo.",
  "billing.group_full":
    "Este grupo llegó al límite de miembros del plan gratuito. El dueño puede mejorarlo a Pro para invitar a más personas.",
  "billing.templates_full":
    "Este grupo llegó al límite de plantillas recurrentes del plan gratuito. El dueño puede mejorarlo a Pro para agregar más.",
  "billing.registries_full":
    "Alcanzaste el límite de 2 grupos del plan gratuito. Mejora uno a Pro o elimina un grupo para crear otro.",
  "billing.history_locked": "Cortes anteriores disponibles en Pro",
  "billing.history_locked_cta": "Desbloquear historial completo",
  "billing.monthly": "Mensual",
  "billing.yearly": "Anual",
  "billing.manage": "Administrar suscripción",
  "billing.success_title": "¡Pro activado!",
  "billing.success_desc":
    "Tu grupo ahora tiene acceso ilimitado. Todos los miembros se benefician.",
  "billing.success_pending_title": "Procesando pago…",
  "billing.success_pending_desc":
    "Tu pago está siendo confirmado. Esto puede tardar unos segundos; el Pro se activará automáticamente.",
  "billing.back_to_dashboard": "Volver al dashboard",
  "billing.view_plans": "Ver planes",

  "pricing.title": "Precios",
  "pricing.subtitle": "Empieza gratis. Mejora tu grupo cuando crezca.",
  "pricing.free_name": "Gratis",
  "pricing.free_registries": "Hasta {n} registros propios",
  "pricing.free_members": "Hasta {n} miembros por registro",
  "pricing.free_templates": "Hasta {n} plantillas recurrentes",
  "pricing.free_history": "Último corte en el historial",
  "pricing.unlimited_core":
    "Transacciones, pagos y cortes ilimitados desde el día uno",
  "pricing.pro_name": "Pro",
  "pricing.pro_includes": "Todo lo del plan gratuito, más:",
  "pricing.pro_members": "Miembros ilimitados por registro",
  "pricing.pro_templates": "Plantillas recurrentes ilimitadas",
  "pricing.pro_history": "Historial completo de cortes",
  "pricing.pro_registries": "Registros propios ilimitados",
  "pricing.per_month": "/mes",
  "pricing.per_year": "/año",
  "pricing.subscribe": "Suscribirse",
  "pricing.have_account": "¿Ya tienes cuenta? Inicia sesión",
  "pricing.choose_registry": "Elige el registro a mejorar:",
  "pricing.active_badge": "Activo",
  "pricing.active_until": "Activo hasta {date}",
  "pricing.cancel_scheduled": "Cancelado — activo hasta {date}",
  "pricing.grandfathered_note": "Early adopter: Pro para siempre",
  "pro.crown_sub": "Pro — gestionar suscripción",
  "pro.crown_founding": "Pro — miembro fundador (para siempre)",
  "pricing.cancel_link": "Cancelar suscripción",
  "pricing.cancel_title": "Cancelar suscripción",
  "pricing.cancel_body":
    "Tu suscripción seguirá activa hasta el {date}. Después, cualquier grupo sin otro miembro Pro volverá al plan gratuito — nadie pierde datos, solo se aplican los límites.",
  "pricing.cancel_confirm": "Sí, cancelar",
  "pricing.keep_sub": "Mantener suscripción",
  "pricing.reactivate": "Reactivar",
  "pricing.create_first": "Crea tu primer registro",
  "pricing.create_first_hint":
    "El plan Pro se contrata por registro — crea el tuyo para empezar.",

  // --- Billing: already-subscribed guard + plan switch ---
  "billing.already_subscribed":
    "Ya tienes una suscripción activa — cubre todos los grupos en los que estás. Para cambiar de plan, usa la opción de cambio de abajo.",
  "billing.switch_to_yearly": "Cambiar a plan anual",
  "billing.switch_to_monthly": "Cambiar a plan mensual",
  "billing.switch_title": "¿Cambiar de plan?",
  "billing.switch_body":
    "¿Cambiar al plan {plan}? El cambio se aplica sobre tu suscripción actual y se prorratea — solo pagas (o se te acredita) la diferencia por el tiempo restante.",
  "billing.switch_confirm": "Cambiar de plan",
  "billing.switch_keep": "Mantener plan actual",
  "billing.switch_error":
    "El cambio de plan falló. Inténtalo de nuevo o gestiona tu suscripción desde el portal.",

  // --- Demo tour (driver.js) ---
  "tour.button_title": "Tour guiado",
  "tour.next": "Siguiente →",
  "tour.prev": "← Anterior",
  "tour.done": "Listo ✓",
  "tour.menu_title": "🎓 Tour Guiado",
  "tour.menu_desc": "Conoce las funciones de A la Par en pocos minutos.",
  "tour.quick_title": "Tour Rápido",
  "tour.quick_sub": "Lo esencial en 5 pasos",
  "tour.full_title": "Tour Completo",
  "tour.full_sub": "Incluye el modal de gastos y pagos",
  "tour.balance_title": "💰 Balance Total",
  "tour.balance_desc":
    "Este es tu balance neto. Verde = te deben, rojo = debes. Haz clic para ver el desglose detallado por persona.",
  "tour.search_title": "🔍 Buscar y Filtrar",
  "tour.search_desc":
    "Busca transacciones por nombre o filtra por persona con los botones de arriba.",
  "tour.transactions_title": "📋 Transacciones",
  "tour.transactions_desc":
    "Aquí verás todos los gastos y pagos del registro actual, ordenados por fecha.",
  "tour.transactions_full_desc":
    "Todos los gastos y pagos del registro. Cada tarjeta muestra quién pagó y cómo se dividió.",
  "tour.add_expense_title": "➕ Agregar Gasto",
  "tour.add_expense_desc":
    "Usa este botón para registrar un gasto. Puedes dividirlo entre todos en partes iguales, por porcentaje, o con montos fijos.",
  "tour.add_expense_full_desc":
    "Vamos a abrir el formulario para crear un gasto y ver las opciones disponibles.",
  "tour.add_payment_title": "💸 Agregar Pago",
  "tour.add_payment_desc":
    "Usa este botón para registrar un pago entre personas y saldar deudas.",
  "tour.edit_title": "✏️ Editar Transacciones",
  "tour.edit_desc":
    "Haz clic en cualquier transacción para ver sus detalles, editarla o eliminarla.",
  "tour.expense_type_title": "🏷️ Tipo de Gasto",
  "tour.expense_type_desc":
    "Elige el tipo: Único (pago una sola vez), Parcialidad (pagos en partes, ej. un laptop a meses), o Recurrente (se repite cada periodo, ej. la renta).",
  "tour.split_mode_title": "🔀 Modo de División",
  "tour.split_mode_desc":
    "Decide cómo dividir el gasto: Automático (partes iguales), Porcentaje (ej. 60%/40%), o Monto Fijo (cantidades específicas por persona).",
  "tour.pay_debt_title": "✅ Saldar Deuda",
  "tour.pay_debt_desc":
    "Cuando alguien te debe, este botón calcula automáticamente el monto exacto. Un clic y el pago queda registrado por la cantidad correcta.",
  "tour.finale_title": "🎉 ¡Eso es todo!",
  "tour.finale_desc":
    "Ya conoces las funciones principales de A la Par. Explora el demo libremente — todos los cambios son temporales y se reinician al recargar.",
};
