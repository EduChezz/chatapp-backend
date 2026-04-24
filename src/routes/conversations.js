const router = require('express').Router()
const auth = require('../middleware/auth')
const prisma = require('../config/db') // Nuestra nueva conexión

// Obtener todas las conversaciones del usuario
router.get('/', auth, async (req, res) => {
  try {
    const conversaciones = await prisma.conversation.findMany({
      where: {
        members: { some: { user_id: req.user.id } }
      },
      include: {
        messages: {
          orderBy: { created_at: 'desc' },
          take: 1 // Solo traemos el último mensaje
        },
        _count: {
          select: {
            messages: { where: { read: false, sender_id: { not: req.user.id } } }
          }
        }
      }
    })

    // Moldeamos los datos para que el Frontend de React los lea igualito que antes
    const result = conversaciones.map(c => ({
      id: c.id,
      name: c.name,
      is_group: c.is_group,
      color: c.color,
      created_at: c.created_at,
      last_message: c.messages[0]?.content || null,
      last_message_time: c.messages[0]?.created_at || null,
      unread_count: c._count.messages
    })).sort((a, b) => new Date(b.last_message_time || 0) - new Date(a.last_message_time || 0))

    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Crear conversación directa o grupo
router.post('/', auth, async (req, res) => {
  const { name, is_group, color, member_ids } = req.body
  try {
    const allMembers = [...new Set([req.user.id, ...member_ids])]
    
    // Prisma nos permite crear la conversación y sus miembros en 1 solo paso
    const conv = await prisma.conversation.create({
      data: {
        name,
        is_group: is_group || false,
        color: color || '#3b82f6',
        members: {
          create: allMembers.map(uid => ({ user_id: uid }))
        }
      }
    })
    res.status(201).json(conv)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Buscar usuarios para agregar
router.get('/users/search', auth, async (req, res) => {
  const { q } = req.query
  try {
    const users = await prisma.user.findMany({
      where: {
        id: { not: req.user.id },
        OR: [
          { name: { contains: q, mode: 'insensitive' } }, // Insensitive para que no importe mayúsculas
          { email: { contains: q, mode: 'insensitive' } }
        ]
      },
      select: { id: true, name: true, email: true, avatar_color: true, status: true },
      take: 10
    })
    res.json(users)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router