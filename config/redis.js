const { createClient } = require('redis')

const redisClient = createClient({
  url: process.env.REDIS_URL,
  socket: {
    tls: true,
    rejectUnauthorized: false
  }
})

redisClient.on('error - redis.js:11', (err) => console.log('❌ Error en Redis:', err))

module.exports = redisClient