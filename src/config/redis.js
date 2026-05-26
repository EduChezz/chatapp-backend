const { createClient } = require('redis')

const redisClient = createClient({
  url: process.env.REDIS_URL,
  socket: {
    tls: true,
    rejectUnauthorized: false,
    reconnectStrategy: (retries) => {
      if (retries > 10) return new Error('Too many retries')
      return Math.min(retries * 500, 3000)
    }
  }
})

redisClient.on('error - redis.js:15', (err) => console.log('❌ Error en Redis:', err.message))
redisClient.on('reconnecting - redis.js:16', () => console.log('🔄 Reconectando a Redis...'))
redisClient.on('ready - redis.js:17', () => console.log('🟢 Redis listo'))

module.exports = redisClient