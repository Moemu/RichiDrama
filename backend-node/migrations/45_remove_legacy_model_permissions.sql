-- Model grants are no longer part of the product policy. Every authenticated
-- user can use every active, configured, and priced model while their balance
-- is sufficient. Remove the unused legacy table so it cannot be mistaken for
-- an access-control source or populated by an external maintenance script.
DROP TABLE IF EXISTS model_permissions;
