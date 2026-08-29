-- What the chain actually commits to.
--
-- AskEscrow.claim() takes an evidenceHash and emits it in Claimed(), which is
-- the whole basis for saying a verification is provable: anybody can fetch the
-- file, hash it, and compare against Base without trusting this server.
--
-- Except the hash was keccak256 of a *string identifying* the evidence, and
-- the string the app sent was `shots[0].uri` — a file:// path on one phone,
-- which existed nowhere else and meant nothing to anybody. Swapping the stored
-- photo afterwards would not have changed it, because it was never a hash of
-- the photo. The commitment was real and empty.
--
-- Computed from the bytes at upload, when they are in hand, rather than read
-- back from storage later: the point is to fix what arrived.
ALTER TABLE evidence ADD COLUMN content_hash TEXT;

COMMENT ON COLUMN evidence.content_hash IS
  'keccak256 of the file bytes, 0x-prefixed. Matches the hashing the contract '
  'uses so an on-chain value can be compared directly. Null for rows written '
  'before this existed — those files were never committed to honestly and '
  'cannot be backfilled from a hash that was of something else.';

CREATE INDEX evidence_content_hash_idx ON evidence (content_hash)
  WHERE content_hash IS NOT NULL;
