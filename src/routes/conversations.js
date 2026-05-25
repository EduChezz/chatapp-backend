const router = require('express').Router()
const auth = require('../middleware/auth')
const prisma = require('../config/db')

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
          take: 1 
        },
        _count: {
          select: {
            messages: { where: { read: false, sender_id: { not: req.user.id } } }
          }
        },
        members: {
          include: {
            user: { select: { name: true, avatar_color: true } }
          }
        }
      }
    })

    const result = conversaciones.map(c => {
    const myMember = c.members.find(m => m.user_id === req.user.id)
    const otherMember = c.members.find(m => m.user_id !== req.user.id)

    return {
      id: c.id,
      name: !c.is_group && otherMember ? otherMember.user.name : c.name,
      is_group: c.is_group,
      color: !c.is_group && otherMember ? otherMember.user.avatar_color : c.color,
      created_at: c.created_at,
      last_message: c.messages[0]?.content || null,
      last_message_time: c.messages[0]?.created_at || null,
      unread_count: c._count.messages,
      other_user_id: !c.is_group && otherMember ? otherMember.user_id : null,
      is_favorite: myMember?.is_favorite || false
    }
  }).sort((a, b) => new Date(b.last_message_time || 0) - new Date(a.last_message_time || 0))

    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Crear conversación directa o grupo
router.post('/', auth, async (req, res) => {
  const { name, is_group, color, member_ids } = req.body
  try {
    const membersList = Array.isArray(member_ids) ? member_ids : [member_ids]
    const allMembers = [...new Set([req.user.id, ...membersList])]
    
    if (!is_group && allMembers.length === 2) {
      const existing = await prisma.conversation.findFirst({
        where: {
          is_group: false,
          AND: [
            { members: { some: { user_id: allMembers[0] } } },
            { members: { some: { user_id: allMembers[1] } } }
          ]
        }
      })
      if (existing) return res.status(200).json(existing)
    }

    const conv = await prisma.conversation.create({
      data: {
        name: name || null,
        is_group: is_group || false,
        color: color || '#3b82f6',
        members: {
          create: allMembers.map(uid => ({
            user: { connect: { id: uid } }
          }))
        }
      }
    })
    res.status(201).json(conv)
  } catch (err) {
    console.error("🔥 Error creando chat: - conversations.js:88", err.message)
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
          { name: { contains: q, mode: 'insensitive' } }, 
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

// Verificar si un usuario está bloqueado
router.get('/block/:userId', auth, async (req, res) => {
  const { userId } = req.params
  try {
    const contact = await prisma.contact.findUnique({
      where: { user_id_contact_id: { user_id: req.user.id, contact_id: userId } }
    })
    res.json({ is_blocked: contact?.is_blocked || false })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Bloquear / desbloquear usuario
router.post('/block/:userId', auth, async (req, res) => {
  const { userId } = req.params
  try {
    const existing = await prisma.contact.findUnique({
      where: { user_id_contact_id: { user_id: req.user.id, contact_id: userId } }
    })

    if (existing) {
      const updated = await prisma.contact.update({
        where: { user_id_contact_id: { user_id: req.user.id, contact_id: userId } },
        data: { is_blocked: !existing.is_blocked }
      })
      return res.json({ is_blocked: updated.is_blocked })
    }

    await prisma.contact.create({
      data: { user_id: req.user.id, contact_id: userId, is_blocked: true }
    })
    res.json({ is_blocked: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Marcar / desmarcar conversación como favorita
router.post('/favorite/:id', auth, async (req, res) => {
  const { id } = req.params
  try {
    const member = await prisma.conversationMember.findUnique({
      where: { user_id_conversation_id: { user_id: req.user.id, conversation_id: id } }
    })
    if (!member) return res.status(404).json({ error: 'No eres miembro de esta conversación' })

    const updated = await prisma.conversationMember.update({
      where: { user_id_conversation_id: { user_id: req.user.id, conversation_id: id } },
      data: { is_favorite: !member.is_favorite }
    })
    res.json({ is_favorite: updated.is_favorite })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Obtener la lista de integrantes de un grupo
router.get('/:id/members', auth, async (req, res) => {
  try {
    const conversationId = req.params.id;
    const chat = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        members: {
          include: { user: true }
        }
      }
    });

    const users = chat ? chat.members.map(m => m.user) : [];
    res.json(users);
  } catch (err) {
    console.error("🔥 Error cargando integrantes: - conversations.js:187", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Eliminar a un integrante de un grupo
router.delete('/:id/members/:userId', auth, async (req, res) => {
  try {
    const conversationId = req.params.id;
    const userToRemove = req.params.userId;

    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        members: {
          deleteMany: { user_id: userToRemove }
        }
      }
    });

    res.json({ message: 'Usuario eliminado del grupo exitosamente' });
  } catch (err) {
    console.error("🔥 Error eliminando integrante: - conversations.js:209", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Añadir un nuevo integrante a un grupo existente
router.post('/:id/members', auth, async (req, res) => {
  try {
    const conversationId = req.params.id;
    const { userId } = req.body; 

    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        members: {
          create: { user: { connect: { id: userId } } }
        }
      }
    });

    res.json({ message: 'Usuario añadido exitosamente' });
  } catch (err) {
    console.error("🔥 Error añadiendo integrante: - conversations.js:231", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Marcar todos los mensajes de una conversación como leídos
router.put('/:id/read', auth, async (req, res) => {
  try {
    const conversationId = req.params.id;
    
    await prisma.message.updateMany({
      where: {
        conversation_id: conversationId,
        sender_id: { not: req.user.id }, 
        read: false
      },
      data: { read: true }
    });

    res.json({ message: 'Mensajes marcados como leídos exitosamente' });
  } catch (err) {
    console.error("🔥 Error al marcar como leído: - conversations.js:252", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Eliminar un chat
router.delete('/:id', auth, async (req, res) => {
  try {
    const conversationId = req.params.id;
    
    await prisma.message.deleteMany({
      where: { conversation_id: conversationId }
    });
    
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { members: { deleteMany: {} } }
    });

    await prisma.conversation.delete({
      where: { id: conversationId }
    });

    res.json({ message: 'Chat eliminado exitosamente' });
  } catch (err) {
    console.error("🔥 Error eliminando chat: - conversations.js:277", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router