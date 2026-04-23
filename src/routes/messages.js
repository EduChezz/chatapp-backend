const router = require('express').Router()
const auth = require('../middleware/auth')
const { pool } = require('../config/db')

// Obtener mensajes de una conversación
router.get('/:conversationId', auth, async (req, res) => {
  const { conversationId } = req.params
  try {
    const result = await pool.query(`
      SELECT 
        m.id, m.content, m.type, m.file_name, m.file_size,
        m.read, m.created_at,
        m.sender_id = $2 AS sent,
        u.name AS sender_name,
        u.avatar_color AS sender_color,
        COALESCE(
          json_agg(
            json_build_object('emoji', r.emoji, 'count', 1)
          ) FILTER (WHERE r.id IS NOT NULL), '[]'
        ) AS reactions
      FROM messages m
      JOIN users u ON u.id = m.sender_id
      LEFT JOIN reactions r ON r.message_id = m.id
      WHERE m.conversation_id = $1
      GROUP BY m.id, u.name, u.avatar_color
      ORDER BY m.created_at ASC
    `, [conversationId, req.user.id])

    // Marcar como leídos
    await pool.query(
      'UPDATE messages SET read = TRUE WHERE conversation_id = $1 AND sender_id != $2',
      [conversationId, req.user.id]
    )

    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Agregar reacción
router.post('/:messageId/reactions', auth, async (req, res) => {
  const { emoji } = req.body
  const { messageId } = req.params
  try {
    await pool.query(
      'INSERT INTO reactions (message_id, user_id, emoji) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [messageId, req.user.id, emoji]
    )
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router