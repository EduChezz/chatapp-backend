const router = require('express').Router()
const auth = require('../middleware/auth')
const { pool } = require('../config/db')

// Obtener todas las conversaciones del usuario
router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        c.id, c.name, c.is_group, c.color, c.created_at,
        (
          SELECT content FROM messages
          WHERE conversation_id = c.id
          ORDER BY created_at DESC LIMIT 1
        ) AS last_message,
        (
          SELECT created_at FROM messages
          WHERE conversation_id = c.id
          ORDER BY created_at DESC LIMIT 1
        ) AS last_message_time,
        (
          SELECT COUNT(*) FROM messages
          WHERE conversation_id = c.id AND read = FALSE AND sender_id != $1
        ) AS unread_count
      FROM conversations c
      JOIN conversation_members cm ON cm.conversation_id = c.id
      WHERE cm.user_id = $1
      ORDER BY last_message_time DESC NULLS LAST
    `, [req.user.id])
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Crear conversación directa o grupo
router.post('/', auth, async (req, res) => {
  const { name, is_group, color, member_ids } = req.body
  try {
    const conv = await pool.query(
      'INSERT INTO conversations (name, is_group, color) VALUES ($1, $2, $3) RETURNING *',
      [name, is_group || false, color || '#3b82f6']
    )
    const convId = conv.rows[0].id

    // Agregar al creador + miembros
    const allMembers = [...new Set([req.user.id, ...member_ids])]
    for (const uid of allMembers) {
      await pool.query(
        'INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2)',
        [convId, uid]
      )
    }
    res.status(201).json(conv.rows[0])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Buscar usuarios para agregar
router.get('/users/search', auth, async (req, res) => {
  const { q } = req.query
  try {
    const result = await pool.query(
      `SELECT id, name, email, avatar_color, status 
       FROM users 
       WHERE (name ILIKE $1 OR email ILIKE $1) AND id != $2
       LIMIT 10`,
      [`%${q}%`, req.user.id]
    )
    res.json(result.rows)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router