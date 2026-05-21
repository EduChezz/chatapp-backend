const jwt = require('jsonwebtoken')
const redisClient = require('../config/redis')

module.exports = async (req, res, next) => {
  const header = req.headers.authorization
  if (!header) return res.status(401).json({ error: 'Token requerido' })

  const token = header.split(' ')[1]
  try {
    // Verificar si el token está en la blacklist
    const isBlacklisted = await redisClient.get(`blacklist:${token}`)
    if (isBlacklisted) return res.status(401).json({ error: 'Sesión cerrada' })

    req.user = jwt.verify(token, process.env.JWT_SECRET)
    next()
  } catch {
    res.status(401).json({ error: 'Token inválido' })
  }
}