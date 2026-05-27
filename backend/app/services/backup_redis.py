import os, asyncio, datetime, json import redis.asyncio as aioredis from app.services.storage
import upload_file async def backup(): r = await aioredis.from_url( os.environ['REDIS_URL'],
decode_responses=False ) keys = await r.keys('*') data = {} for key in keys: k = key.decode() if
isinstance(key, bytes) else key t = await r.type(key) if t in ('string', b'string'): v = await
r.get(key) data[k] = v.decode() if isinstance(v, bytes) else v elif t in ('list', b'list'): v =
await r.lrange(key, 0, -1) data[k] = [x.decode() if isinstance(x, bytes) else x for x in v] elif
t in ('hash', b'hash'): v = await r.hgetall(key) data[k] = {(a.decode() if isinstance(a,bytes)
else a): (b.decode() if isinstance(b,bytes) else b) for a,b in v.items()} elif t in ('set',
b'set'): v = await r.smembers(key) data[k] = list(v) ts =
datetime.datetime.utcnow().strftime('%Y-%m-%dT%H-%M-%S') tmp = f'/tmp/redis_backup_{ts}.json'
with open(tmp, 'w') as f: json.dump(data, f) r2_key = f'backups/redis/{ts}.json' url = await
upload_file(tmp, r2_key) print(f'Backup complete: {len(data)} keys -> {url}') await r.aclose()
if __name__ == '__main__': asyncio.run(backup())
