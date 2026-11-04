-- perform_corte: settles a registry period entirely server-side.
--
-- Replaces the JS loop in /api/exercises that made ~44 round-trips
-- (4 per pairwise ajuste × up to N(N-1)/2 ajustes) with ONE call.
--
-- Semantics replicate calculateFullPairwiseBalances + createTransaction:
--   • Pairwise: for each pair (a,b), net = owed(a→b) − owed(b→a);
--     |net| < $0.01 → skip; the debtor pays the creditor via an ajuste.
--   • Ajuste: type='ajuste', userPaid = creditor, split 100% to creditor,
--     description "Pendiente de {debtor} a favor de {creditor}".
--   • Balance deltas: creditor +amount only (computeDeltas skips the
--     second entry when recipient === userPaid, so debtor gets no delta —
--     the debtor's fresh start is $0 because old deltas are archived).
--   • Registry stamp touched ONCE.
--
-- The pairwise debt between creditor A and debtor B is derived from
-- transaction_balances: for each archived transaction where A has a
-- positive delta (they fronted money) and B has a negative delta (they
-- consumed), B's |negative delta| is what B owes A from that transaction.
-- Sum across all transactions, then net each unordered pair.

CREATE OR REPLACE FUNCTION perform_corte(
  p_registry_id uuid,
  p_user_id     uuid
)
RETURNS TABLE (
  out_exercise_id     uuid,
  out_exercise_start  timestamptz,
  out_exercise_end    timestamptz,
  out_tx_count        bigint,
  out_total_amount    numeric,
  out_adjustments     int
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_exercise_id uuid;
  v_count       bigint;
  v_total       numeric;
  v_start       timestamptz;
  v_adjustments int := 0;
BEGIN
  -- ── Guard: owner-only. ──
  IF NOT EXISTS (
    SELECT 1 FROM registry_members
    WHERE registry_id = p_registry_id AND user_id = p_user_id AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'not_owner' USING HINT = 'Caller must own the registry';
  END IF;

  -- ── Guard: must have active transactions. ──
  SELECT COUNT(*), COALESCE(SUM(ABS(original_amount)), 0), COALESCE(MIN(created_at), now())
    INTO v_count, v_total, v_start
  FROM transactions
  WHERE registry_id = p_registry_id AND exercise_id IS NULL;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'no_active_transactions';
  END IF;

  -- ── Step 1: Create exercise + archive all active transactions. ──
  WITH new_exercise AS (
    INSERT INTO exercises (registry_id, start_date, end_date, transaction_count, total_amount)
    VALUES (p_registry_id, v_start, now(), v_count, v_total)
    RETURNING id
  ),
  archived AS (
    UPDATE transactions
    SET exercise_id = (SELECT id FROM new_exercise)
    WHERE registry_id = p_registry_id AND exercise_id IS NULL
  )
  SELECT id INTO v_exercise_id FROM new_exercise;

  -- ── Step 2: Pairwise debts from transaction_balances. ──
  -- creditor = the user with the positive delta on each transaction (they
  -- fronted money); debtor = a user with a negative delta on the same
  -- transaction. |debtor's delta| = what they owe the creditor from that tx.
  --
  -- Stored in a temp table as directed edges: (creditor, debtor, amount_owed).
  -- Multiple rows per (creditor,debtor) if they shared multiple transactions;
  -- the subsequent pair-netting pass resolves them.
  CREATE TEMP TABLE _pairwise
  ON COMMIT DROP
  AS
  SELECT
    pay.user_id  AS creditor_id,
    owe.user_id  AS debtor_id,
    SUM(ABS(owe.amount)) AS owed
  FROM transaction_balances pay
  JOIN transaction_balances owe
       ON owe.transaction_id = pay.transaction_id
      AND owe.user_id <> pay.user_id
  JOIN transactions t ON t.id = pay.transaction_id
  WHERE t.exercise_id = v_exercise_id
    AND pay.amount > 0
    AND owe.amount < 0
  GROUP BY pay.user_id, owe.user_id;

  -- ── Step 3: Net each unordered pair; create ajustes for |net| ≥ $0.01. ──
  -- All directed edges for the same unordered pair collapse into ONE row
  -- via GROUP BY: edges where user_lo is the creditor count positive,
  -- edges where user_hi is the creditor count negative. This avoids the
  -- self-join pitfall where each pair produced two rows (one per direction)
  -- and duplicated ajustes.
  WITH pair_net AS (
    SELECT
      LEAST(creditor_id, debtor_id)   AS user_lo,
      GREATEST(creditor_id, debtor_id) AS user_hi,
      -- Positive → user_hi owes user_lo; negative → user_lo owes user_hi.
      SUM(
        CASE WHEN creditor_id = LEAST(creditor_id, debtor_id)
             THEN owed ELSE -owed END
      ) AS net_lo_hi
    FROM _pairwise
    GROUP BY LEAST(creditor_id, debtor_id), GREATEST(creditor_id, debtor_id)
    HAVING ABS(SUM(
      CASE WHEN creditor_id = LEAST(creditor_id, debtor_id)
           THEN owed ELSE -owed END
    )) >= 0.01
  ),
  debts AS (
    SELECT
      CASE WHEN pn.net_lo_hi > 0 THEN pn.user_lo ELSE pn.user_hi END AS creditor_id,
      CASE WHEN pn.net_lo_hi > 0 THEN pn.user_hi ELSE pn.user_lo END AS debtor_id,
      ABS(pn.net_lo_hi) AS debt_amount
    FROM pair_net pn
  ),
  new_ajustes AS (
    INSERT INTO transactions (
      registry_id, description, amount, original_amount, type,
      exercise_id, recurring_group_id, notes, split_json,
      creator_id, user_paid
    )
    SELECT
      p_registry_id,
      'Ajuste de balance — corte',
      d.debt_amount,
      d.debt_amount,
      'ajuste',
      NULL,
      gen_random_uuid(),
      'Ajuste de balance pendiente del ejercicio anterior',
      jsonb_build_object('splits', jsonb_build_array(
        jsonb_build_object(
          'userId', d.creditor_id,
          'percentage', 100,
          'amount', d.debt_amount
        )
      )),
      p_user_id,
      d.creditor_id
    FROM debts d
    RETURNING id, user_paid, original_amount
  ),
  creditor_deltas AS (
    INSERT INTO transaction_balances (transaction_id, user_id, amount)
    SELECT na.id, na.user_paid, na.original_amount
    FROM new_ajustes na
  )
  SELECT COUNT(*) INTO v_adjustments FROM new_ajustes;

  -- ── Step 4: Touch the registry stamp ONCE. ──
  UPDATE registries SET last_modified = now() WHERE id = p_registry_id;

  DROP TABLE IF EXISTS _pairwise;

  RETURN QUERY SELECT
    v_exercise_id, v_start, now(), v_count, v_total, v_adjustments;

EXCEPTION
  WHEN OTHERS THEN
    DROP TABLE IF EXISTS _pairwise;
    RAISE;
END;
$$;
