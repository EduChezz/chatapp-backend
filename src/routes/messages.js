const router = require('express').Router()
const auth = require('../middleware/auth')
const prisma = require('../config/db')

// Obtener mensajes de una conversación
router.get('/:conversationId', auth, async (req, res) => {
  const { conversationId } = req.params
  try {
    // 1. Buscamos los mensajes con sus reacciones y datos del remitente
    const messages = await prisma.message.findMany({
  where: { conversation_id: id },
  include: {
    sender: true,
    reactions: true 
  },
  orderBy: { created_at: 'asc' }
});

    // 2. Marcamos como leídos los mensajes que no envié yo
    await prisma.message.updateMany({
      where: { 
        conversation_id: conversationId, 
        sender_id: { not: req.user.id },
        read: false
      },
      data: { read: true }
    })

    // 3. Adaptamos las reacciones al formato del frontend
    const result = msgs.map(m => {
      // Agrupamos las reacciones por emoji para contarlas
      const groupedReactions = (m.reactions || []).reduce((acc, r) => {
        const existing = acc.find(x => x.emoji === r.emoji)
        if (existing) existing.count++
        else acc.push({ emoji: r.emoji, count: 1 })
        return acc
      }, [])

      return {
        id: m.id, content: m.content, type: m.type, 
        file_name: m.file_name, file_size: m.file_size,
        read: m.read, created_at: m.created_at,
        sent: m.sender_id === req.user.id,
        sender_name: m.sender?.name,
        sender_color: m.sender?.avatar_color,
        reactions: groupedReactions
      }
    })

    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Agregar reacción
router.post('/:messageId/reactions', auth, async (req, res) => {
  const { emoji } = req.body
  const { messageId } = req.params
  try {
    // Usamos upsert para que si ya existe la reacción, no haga nada (evitar errores)
    await prisma.reaction.upsert({
      where: {
        user_id_message_id_emoji: {
          user_id: req.user.id,
          message_id: messageId,
          emoji: emoji
        }
      },
      update: {}, 
      create: {
        user_id: req.user.id,
        message_id: messageId,
        emoji: emoji
      }
    })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router