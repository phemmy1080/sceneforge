import os, asyncio, datetime, json
import redis.asyncio as aioredis
from app.services.storage import upload_file


async def backup():
    r = await aioredis.from_url(
        os.environ['REDIS_URL'],
        decode_responses=False
    )

    data = {}
    count = 0

    # scan_iter instead of KEYS * - non-blocking, safe on large keyspaces
    async for key in r.scan_iter('*', count=200):
        k = key.decode() if isinstance(key, bytes) else key
        t = await r.type(key)
        t = t.decode() if isinstance(t, bytes) else t

        if t == 'string':
            v = await r.get(key)
            value = v.decode() if isinstance(v, bytes) else v

        elif t == 'list':
            v = await r.lrange(key, 0, -1)
            value = [x.decode() if isinstance(x, bytes) else x for x in v]

        elif t == 'hash':
            v = await r.hgetall(key)
            value = {
                (a.decode() if isinstance(a, bytes) else a):
                (b.decode() if isinstance(b, bytes) else b)
                for a, b in v.items()
            }

        elif t == 'set':
            v = await r.smembers(key)
            value = [x.decode() if isinstance(x, bytes) else x for x in v]

        elif t == 'zset':
            v = await r.zrange(key, 0, -1, withscores=True)
            value = [
                [m.decode() if isinstance(m, bytes) else m, s]
                for m, s in v
            ]

        else:
            print(f"Skipping key '{k}' with unsupported type '{t}'")
            continue

        # Critical fix: record the Redis type alongside the value so restore
        # knows whether to SADD, RPUSH, HSET, SET, or ZADD it back.
        data[k] = {"type": t, "value": value}
        count += 1

    ts = datetime.datetime.utcnow().strftime('%Y-%m-%dT%H-%M-%S')
    tmp = f'/tmp/redis_backup_{ts}.json'
    with open(tmp, 'w') as f:
        json.dump(data, f)

    r2_key = f'backups/redis/{ts}.json'
    url = await upload_file(tmp, r2_key)
    print(f'Backup complete: {count} keys -> {url}')
    await r.aclose()


if __name__ == '__main__':
    asyncio.run(backup())
