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
        // NUEVO: Le pedimos a Prisma que traiga los datos del "otro" usuario en el chat
        members: {
          where: { user_id: { not: req.user.id } },
          include: {
            user: { select: { name: true, avatar_color: true } }
          }
        }
      }
    })

    const result = conversaciones.map(c => {
      // Lógica dinámica: Si NO es grupo, robamos el nombre y color del otro miembro
      let chatName = c.name;
      let chatColor = c.color;

      if (!c.is_group && c.members && c.members.length > 0) {
        chatName = c.members[0].user.name;
        chatColor = c.members[0].user.avatar_color;
      }

      return {
        id: c.id,
        name: chatName,
        is_group: c.is_group,
        color: chatColor,
        created_at: c.created_at,
        last_message: c.messages[0]?.content || null,
        last_message_time: c.messages[0]?.created_at || null,
        unread_count: c._count.messages
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
    // 1. Protección por si member_ids no es un array
    const membersList = Array.isArray(member_ids) ? member_ids : [member_ids]
    const allMembers = [...new Set([req.user.id, ...membersList])]
    
    // 2. Anti-duplicados: Si es un chat directo (2 personas), buscar si ya existe
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
      // Si ya existe, devolvemos el chat antiguo y cortamos la ejecución
      if (existing) return res.status(200).json(existing)
    }

    // 3. Crear el nuevo chat con sintaxis segura
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
    console.error("🔥 Error creando chat: - conversations.js:98", err.message)
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
// Obtener la lista de integrantes de un grupo
router.get('/:id/members', auth, async (req, res) => {
  try {
    const conversationId = req.params.id;
    const chat = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        members: {
          include: { user: true } // Trae los nombres, fotos, etc.
        }
      }
    });

    // Filtramos la data para enviar un arreglo limpio de usuarios
    const users = chat ? chat.members.map(m => m.user) : [];
    res.json(users);
  } catch (err) {
    console.error("🔥 Error cargando integrantes: - conversations.js:140", err.message);
    res.status(500).json({ error: err.message });
  }
});
// Eliminar a un integrante de un grupo
router.delete('/:id/members/:userId', auth, async (req, res) => {
  try {
    const conversationId = req.params.id;
    const userToRemove = req.params.userId;

    // Le decimos a Prisma que actualice el grupo, borrando la conexión con este usuario
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
    console.error("🔥 Error eliminando integrante: - conversations.js:162", err.message);
    res.status(500).json({ error: err.message });
  }
});
// Añadir un nuevo integrante a un grupo existente
router.post('/:id/members', auth, async (req, res) => {
  try {
    const conversationId = req.params.id;
    const { userId } = req.body; 

    // Le decimos a Prisma que actualice el grupo conectando este nuevo usuario
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
    console.error("🔥 Error añadiendo integrante: - conversations.js:184", err.message);
    res.status(500).json({ error: err.message });
  }
});
// Marcar todos los mensajes de una conversación como leídos
router.put('/:id/read', auth, async (req, res) => {
  try {
    const conversationId = req.params.id;
    
    // Actualizamos todos los mensajes del chat que NO enviamos nosotros y que no están leídos
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
    console.error("🔥 Error al marcar como leído: - conversations.js:205", err.message);
    res.status(500).json({ error: err.message });
  }
});
// Eliminar un chat (solo la conversación y sus mensajes)
router.delete('/:id', auth, async (req, res) => {
  try {
    const conversationId = req.params.id;
    
    // 1. Borramos todos los mensajes de este chat primero
    await prisma.message.deleteMany({
      where: { conversation_id: conversationId }
    });
    
    // 2. Desvinculamos a los participantes del chat
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { members: { deleteMany: {} } }
    });

    // 3. Finalmente, borramos el chat vacío
    await prisma.conversation.delete({
      where: { id: conversationId }
    });

    res.json({ message: 'Chat eliminado exitosamente' });
  } catch (err) {
    console.error("🔥 Error eliminando chat: - conversations.js:232", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router