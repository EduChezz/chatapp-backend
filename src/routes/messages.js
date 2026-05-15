const router = require('express').Router()
const auth = require('../middleware/auth')
const prisma = require('../config/db')

router.get('/:conversationId', auth, async (req, res) => {
  const { conversationId } = req.params // Esta es la variable correcta
  try {
    const messages = await prisma.message.findMany({
      where: { conversation_id: conversationId }, // Cambia 'id' por 'conversationId'
      include: {
        sender: true,
        reactions: true 
      },
      orderBy: { created_at: 'asc' }
    });

    await prisma.message.updateMany({
      where: { 
        conversation_id: conversationId, 
        sender_id: { not: req.user.id },
        read: false
      },
      data: { read: true }
    })

    const result = messages.map(m => {
      // Validación para evitar errores si no hay reacciones
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

router.post('/:messageId/reactions', auth, async (req, res) => {
  const { emoji } = req.body
  const { messageId } = req.params
  try {
    await prisma.reaction.upsert({
      where: {
        // Orden exacto definido en el schema.prisma
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