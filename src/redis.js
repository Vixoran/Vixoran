import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://vixoran_vixoran-redis:6379';

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: false,
  lazyConnect: true,
});

redis.on('connect', () => console.log('✅ Redis conectado'));
redis.on('error', (err) => console.error('Redis error:', err.message));
