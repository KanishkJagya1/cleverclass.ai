-- Landmark on saved addresses.
--
-- Not decoration: for a lot of Indian delivery addresses the landmark is what
-- actually gets the parcel to the door — "opposite Ganesh temple" resolves a
-- street a courier cannot otherwise find. Every checkout form worth using in
-- this market has one.
--
-- Nullable with an empty default so the 014 addresses keep working untouched.

ALTER TABLE addresses ADD COLUMN landmark TEXT NOT NULL DEFAULT '';
