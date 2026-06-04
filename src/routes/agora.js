// backend: src/routes/agora.js
const express = require('express')
const router = express.Router()
const { RtcTokenBuilder, RtcRole } = require('agora-token')

const APP_ID          = process.env.AGORA_APP_ID
const APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE

// POST /api/agora/token
// body: { channelName, uid }
router.post('/token', (req, res) => {
  try {
    const { channelName, uid } = req.body

    if (!APP_ID || !APP_CERTIFICATE) {
      return res.status(500).json({ error: 'Agora credentials not configured' })
    }

    if (!channelName) {
      return res.status(400).json({ error: 'channelName is required' })
    }

    // Token válido por 1 hora
    const expirationInSeconds = 3600
    const currentTimestamp    = Math.floor(Date.now() / 1000)
    const privilegeExpiredTs  = currentTimestamp + expirationInSeconds

    // uid debe ser número entero — convertimos el string UUID a número usando hash simple
    const numericUid = uid ? Math.abs(hashCode(String(uid))) % 100000 : 0

    const token = RtcTokenBuilder.buildTokenWithUid(
      APP_ID,
      APP_CERTIFICATE,
      channelName,
      numericUid,
      RtcRole.PUBLISHER,
      expirationInSeconds,
      privilegeExpiredTs
    )

    res.json({ token, uid: numericUid })
  } catch (err) {
    console.error('Error generando token Agora:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// Hash simple para convertir UUID string a número
function hashCode(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return hash
}

module.exports = router