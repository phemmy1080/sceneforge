"""
backup_redis.py  —  Fast Redis backup using pipelining.

Batches all TYPE checks and all GET/LRANGE/HGETALL calls into pipelines
so the number of round-trips is O(keys/batch) not O(keys).

Each backed-up value is stored as {"type": <redis type>, "value": <data>}
so restore can dispatch to the correct write command (SADD/RPUSH/HSET/SET/
ZADD) instead of guessing from the JSON shape — a plain list is ambiguous
between a Redis LIST and a Redis SET, which is what caused the WRONGTYPE
corruption last time.

Usage:
  python backup_redis.py          # backup to R2
  python backup_redis.py --local  # backup to /tmp only (for testing)
"""
from __future__ import annotations
import os, asyncio, datetime, json, sys, logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger(__name__)

BATCH = 500   # keys per pipeline batch — safe for all Redis providers


async def dump_redis(r) -> dict:
    """Dump all Redis keys to a plain dict using batched pipelines."""
    # Use SCAN instead of KEYS * — works on all providers including Railway
    all_keys = []
    cursor = 0
    while True:
        cursor, batch = await r.scan(cursor, count=500)
        all_keys.extend(batch)
        if cursor == 0:
            break

    total = len(all_keys)
    log.info("Found %d keys to back up", total)
    if total == 0:
        return {}

    data: dict = {}

    # ── Phase 1: get type of every key in batches ──────────────────────────
    types: list[str] = []
    for i in range(0, total, BATCH):
        batch = all_keys[i : i + BATCH]
        pipe  = r.pipeline(transaction=False)
        for k in batch:
            pipe.type(k)
        results = await pipe.execute()
        types.extend(results)
        log.info("  Types fetched: %d / %d", min(i + BATCH, total), total)

    # ── Phase 2: fetch values grouped by type in batches ──────────────────
    # Separate keys by type so we can use the right command per batch
    by_type: dict[str, list] = {}
    for key, t in zip(all_keys, types):
        t_str = t.decode() if isinstance(t, bytes) else t
        by_type.setdefault(t_str, []).append(key)

    for t_str, keys in by_type.items():
        log.info("  Fetching %d keys of type '%s'", len(keys), t_str)
        for i in range(0, len(keys), BATCH):
            batch = keys[i : i + BATCH]
            pipe  = r.pipeline(transaction=False)
            for k in batch:
                if   t_str == "string": pipe.get(k)
                elif t_str == "list":   pipe.lrange(k, 0, -1)
                elif t_str == "hash":   pipe.hgetall(k)
                elif t_str == "set":    pipe.smembers(k)
                elif t_str == "zset":   pipe.zrange(k, 0, -1, withscores=True)
                else:                   pipe.get(k)   # unknown — try string
            values = await pipe.execute()

            for key, value in zip(batch, values):
                k_str = key.decode() if isinstance(key, bytes) else key

                # Normalise bytes → str throughout
                if isinstance(value, bytes):
                    norm_value = value.decode(errors="replace")
                elif isinstance(value, list):
                    norm = []
                    for item in value:
                        if isinstance(item, (list, tuple)):
                            # zset tuple: (member, score)
                            norm.append([
                                item[0].decode(errors="replace") if isinstance(item[0], bytes) else item[0],
                                float(item[1])
                            ])
                        else:
                            norm.append(item.decode(errors="replace") if isinstance(item, bytes) else item)
                    norm_value = norm
                elif isinstance(value, dict):
                    norm_value = {
                        (a.decode(errors="replace") if isinstance(a, bytes) else a):
                        (b.decode(errors="replace") if isinstance(b, bytes) else b)
                        for a, b in value.items()
                    }
                elif isinstance(value, set):
                    norm_value = [
                        x.decode(errors="replace") if isinstance(x, bytes) else x
                        for x in value
                    ]
                elif value is None:
                    norm_value = None
                else:
                    norm_value = value

                # Critical fix: tag the value with its Redis type so restore
                # knows whether to SADD, RPUSH, HSET, SET, or ZADD it back.
                data[k_str] = {"type": t_str, "value": norm_value}

    return data


async def backup(local_only: bool = False):
    import redis.asyncio as aioredis

    url = os.environ["REDIS_URL"]
    is_tls = url.startswith("rediss://")
    if is_tls:
        r = await aioredis.from_url(url, decode_responses=False, ssl_cert_reqs=None)
    else:
        r = await aioredis.from_url(url, decode_responses=False)

    t_start = datetime.datetime.now(datetime.timezone.utc)
    data    = await dump_redis(r)
    await r.aclose()

    ts  = t_start.strftime("%Y-%m-%dT%H-%M-%S")
    tmp = f"/tmp/redis_backup_{ts}.json"
    with open(tmp, "w") as f:
        json.dump(data, f)

    size_kb = os.path.getsize(tmp) / 1024
    elapsed = (datetime.datetime.now(datetime.timezone.utc) - t_start).total_seconds()
    log.info("Backup file written: %s  (%.1f KB, %d keys, %.1fs)",
             tmp, size_kb, len(data), elapsed)

    if local_only:
        log.info("--local flag set — skipping R2 upload")
        return

    # Upload to R2
    from app.services.storage import upload_file
    r2_key = f"backups/redis/{ts}.json"
    url_out = await upload_file(tmp, r2_key)
    log.info("Backup uploaded to R2: %s", url_out)
    log.info("Done. %d keys backed up in %.1fs.", len(data), elapsed)


if __name__ == "__main__":
    local_only = "--local" in sys.argv
    asyncio.run(backup(local_only=local_only))
