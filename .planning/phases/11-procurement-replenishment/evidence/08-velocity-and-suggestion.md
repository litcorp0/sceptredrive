# Plan 08 evidence — the velocity query and one hand-reconciled suggestion

Recorded 2026-10-25 against the development database (`sceptre_drive`, Docker Postgres on
`:5434`) after `db:seed --demo`. Branch `863391e7-adec-4821-8810-fb7d43cb7be4` (the branch with
the demo month's sales), product `995a11db-80ea-4841-89d7-0190d24642cf` (SKU `GIK-00001`).

## 1. The velocity query plans through a hash join, and an index does not change it

The query `replenishment.repository.selectUnitsSold` issues:

```sql
SELECT sl.product_id, coalesce(sum(sl.quantity), 0)
  FROM sale_line sl JOIN sale s ON s.id = sl.sale_id
 WHERE s.branch_id = $1 AND s.occurred_at >= now() - make_interval(days => $2)
 GROUP BY sl.product_id;
```

`EXPLAIN (ANALYZE, BUFFERS)` as shipped:

```text
 HashAggregate  (cost=425.11..425.23 rows=12 width=24) (actual time=3.724..3.732 rows=12.00 loops=1)
   Group Key: sl.product_id
   Batches: 1  Memory Usage: 32kB
   Buffers: shared hit=264
   ->  Hash Join  (cost=166.82..409.15 rows=3191 width=20) (actual time=1.389..3.177 rows=3217.00 loops=1)
         Hash Cond: (sl.sale_id = s.id)
         Buffers: shared hit=264
         ->  Seq Scan on sale_line sl  (cost=0.00..225.81 rows=6281 width=36) (actual time=0.069..0.738 rows=6260.00 loops=1)
               Buffers: shared hit=163
         ->  Hash  (cost=150.96..150.96 rows=1269 width=16) (actual time=1.294..1.295 rows=1288.00 loops=1)
               Buckets: 2048  Batches: 1  Memory Usage: 77kB
               Buffers: shared hit=101
               ->  Seq Scan on sale s  (cost=0.00..150.96 rows=1269 width=16) (actual time=0.010..1.019 rows=1288.00 loops=1)
                     Filter: ((branch_id = '863391e7-…'::uuid) AND (occurred_at >= (now() - '90 days'::interval)))
                     Rows Removed by Filter: 1192
                     Buffers: shared hit=101
 Planning Time: 2.880 ms
 Execution Time: 4.041 ms
(20 rows)
```

The plan seq-scans `sale_line`. The plan set says: *if it seq-scans `sale_line`, add
`sale_line_product_sale_idx` in a small migration and record why.* The index was therefore
added inside a transaction, `ANALYZE` was run, and the query was re-planned; the transaction was
rolled back, so the schema is unchanged.

```sql
BEGIN;
CREATE INDEX sale_line_product_sale_idx ON sale_line (product_id, sale_id);
ANALYZE sale_line;
EXPLAIN (ANALYZE, BUFFERS) SELECT …;   -- same query
ROLLBACK;
```

```text
 HashAggregate  (cost=424.79..424.91 rows=12 width=24) (actual time=2.509..2.516 rows=12.00 loops=1)
   Group Key: sl.product_id
   Buffers: shared hit=264
   ->  Hash Join  (cost=166.82..408.89 rows=3180 width=20) (actual time=0.789..2.090 rows=3217.00 loops=1)
         Hash Cond: (sl.sale_id = s.id)
         ->  Seq Scan on sale_line sl  (cost=0.00..225.60 rows=6260 width=36) (actual time=0.010..0.406 rows=6260.00 loops=1)
               Buffers: shared hit=163
         ->  Hash  (cost=150.96..150.96 rows=1269 width=16) (actual time=0.758..0.759 rows=1288.00 loops=1)
               Buckets: 2048  Batches: 1  Memory Usage: 77kB
               Buffers: shared hit=101
               ->  Seq Scan on sale s … (actual time=0.006..0.569 rows=1288.00 loops=1)
 Planning Time: 1.555 ms
 Execution Time: 2.595 ms
(20 rows)
```

**Conclusion: no index is added, and the reason is recorded rather than assumed.** The query
joins on `sale_id`, not on `product_id`, so a `(product_id, sale_id)` index is not on any path the
planner can use here: it reads 1,288 sales for the branch and hash-joins their 3,217 lines. The
existing `sale_line_sale_idx` already covers the join, and at 4 ms the planner's seq scan is the
cheaper choice. A migration adding an index nothing uses would be a cost with no reader. If the
velocity query is ever rewritten to filter by product first, the index above is the one to add,
and this measurement is the baseline to compare against.

## 2. One suggestion reconciled by hand

The same product, with a threshold of 500 / max 1000 / MOQ 0 and the default lead time (14 days)
and safety days (7). The three statements the plan names:

```text
SELECT quantity_on_hand FROM stock_level WHERE product_id = … AND branch_id = …;
  -> 773

SELECT coalesce(sum(quantity),0) FROM sale_line sl JOIN sale s ON s.id = sl.sale_id
  WHERE sl.product_id = … AND s.branch_id = … AND s.occurred_at >= now() - interval '90 days';
  -> 1542

SELECT coalesce(sum(pol.quantity),0) - coalesce(sum(srl.quantity),0)
  FROM purchase_order_line pol JOIN purchase_order po ON po.id = pol.order_id
  LEFT JOIN stock_receipt_line srl ON srl.purchase_order_line_id = pol.id
  WHERE pol.product_id = … AND po.branch_id = …
    AND po.status IN ('APPROVED','SENT','PARTIALLY_RECEIVED');
  -> 0
```

Arithmetic, in the order `packages/shared/src/replenishment.ts` performs it:

```text
coverage  = ceilDiv(1542 × (14 + 7), 90) = ceilDiv(32382, 90) = 360
target    = max(1000 stored max, 360 coverage) = 1000
position  = 773 on hand + 0 on order = 773
suggested = max(clamp(1000 − 773, 0, 1000), 0) = 227
basis     = STORED_MAX   (no coverage rise, below target)
```

The threshold row used for this check was created inside a transaction and rolled back; the
development database's own two threshold rows are untouched. The unit tests in
`api/src/modules/replenishment/replenishment.test.ts` assert the same arithmetic on every branch
of the formula (coverage, stored max, no history, no level, at target, minimum order, never
stocked).
