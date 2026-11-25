-- The book's line for cents that cannot be divided: the members who have
-- taken a leftover cent, front first. Whoever takes one moves to the back, so
-- among n members everyone waits n − 1 turns, in an order the book keeps for
-- good. The server deals each expense against it inside the transaction that
-- saves the expense (SELECT ... FOR UPDATE), so two saves racing each other
-- cannot hand the same turn to two people; the form only predicts the result.
ALTER TABLE registries ADD COLUMN IF NOT EXISTS remainder_queue JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE registries DROP CONSTRAINT IF EXISTS registries_remainder_queue_check;
ALTER TABLE registries ADD CONSTRAINT registries_remainder_queue_check
  CHECK (jsonb_typeof(remainder_queue) = 'array');
