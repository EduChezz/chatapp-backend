require('dotenv').config()
const express = require('express')
const cors = require('cors')
const http = require('http')
const { Server } = require('socket.io')
const path = require('path')
const prisma = require('./config/db')

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173'

const app = express()
const server = http.createServer(app)

const io = new Server(server, {
  cors: { origin: FRONTEND_URL, methods: ['GET', 'POST'] }
})

app.use(cors({ origin: FRONTEND_URL }))
app.use(express.json())
app.use('/uploads', express.static(path.join(__dirname, '../uploads')))

app.get('/health', (req, res) => res.json({ status: 'ok' }))
app.get('/api/turn-credentials', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  try {
    const client = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    const token = await client.tokens.create()
    res.json(token.iceServers)
  } catch (err) {
    console.error('Error Twilio:', err.message)
    res.status(500).json({ error: err.message })
  }
})


// Rutas
app.use('/api/auth', require('./routes/auth'))
app.use('/api/conversations', require('./routes/conversations'))
app.use('/api/messages', require('./routes/messages'))
app.use('/api/upload', require('./routes/upload'))

const redisClient = require('./config/redis')

// WebSockets con Redis
io.on('connection', (socket) => {
  console.log('馃攲 Socket conectado: ', socket.id)

  // Usuario se conecta
  socket.on('user:join', async (userId) => {
    // 3. Guardamos la conexi贸n en la "b贸veda" de Redis
    await redisClient.hSet('user_sockets', userId, socket.id)
    await redisClient.hSet('socket_users', socket.id, userId)

    // 馃敟 CRUCIAL: El usuario se une a su "cuarto personal" usando su propio ID
    socket.join(userId)

    // Leemos qui茅nes est谩n conectados directamente desde Redis
    const onlineUsers = await redisClient.hKeys('user_sockets')
    io.emit('users:online', onlineUsers)
    console.log(`馃懁 Usuario ${userId} en l铆nea `)
  })

  socket.on('conversation:join', (conversationId) => {
    socket.join(conversationId)
  })

  // 馃敟 AQU脥 EST脕 LA MAGIA DEL TIMBRAZO PERSONAL
  socket.on('message:send', async (data) => {
    const { conversationId, senderId, content, type, fileName, fileSize } = data
    try {
      // Verificar si alg煤n miembro bloque贸 al remitente
      const conv = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: { members: true }
      })

      if (conv && !conv.is_group) {
        const otherMember = conv.members.find(m => m.user_id !== senderId)
        if (otherMember) {
          const blocked = await prisma.contact.findUnique({
            where: {
              user_id_contact_id: {
                user_id: otherMember.user_id,
                contact_id: senderId
              }
            }
          })
          if (blocked?.is_blocked) {
            socket.emit('message:blocked')
            return
          }
        }
      }

      // Guardamos el mensaje en la base de datos
      const msg = await prisma.message.create({
        data: {
          conversation_id: conversationId,
          sender_id: senderId,
          content: content,
          type: type || 'text',
          file_name: fileName || null,
          file_size: fileSize || null
        }
      })

      // Buscamos a todos los participantes de este chat
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: { members: true }
      })

      if (conversation) {
        // Creamos una lista con el cuarto general del chat Y los cuartos personales de cada usuario
        const rooms = [conversationId, ...conversation.members.map(m => m.user_id)]
        
        // io.to(lista) env铆a el mensaje a todos. Socket.io es tan inteligente que 
        // si alguien est谩 en ambos cuartos, NO le duplica el mensaje. 隆Pura magia!
        io.to(rooms).emit('message:new', { ...msg, sent: false })
      } else {
        io.to(conversationId).emit('message:new', { ...msg, sent: false })
      }

    } catch (err) {
      console.error('Error guardando mensaje: ', err.message)
    }
  })

  socket.on('typing:start', ({ conversationId, userName }) => {
    socket.to(conversationId).emit('typing:start', { conversationId, userName });
  });

  socket.on('typing:stop', ({ conversationId }) => {
    socket.to(conversationId).emit('typing:stop', { conversationId });
  });

  socket.on('reaction:add', async ({ conversationId, messageId, emoji, userId }) => {
  try {
    // 1. Verificar si la reacci贸n ya existe (Toggle)
    const existing = await prisma.reaction.findUnique({
      where: {
        user_id_message_id_emoji: {
          user_id: userId,
          message_id: messageId,
          emoji: emoji
        }
      }
    });

    if (existing) {
      // Si ya existe, la quitamos
      await prisma.reaction.delete({ where: { id: existing.id } });
      io.to(conversationId).emit('reaction:remove', { messageId, emoji, userId });
    } else {
      // Si no existe, la guardamos
      await prisma.reaction.create({
        data: {
          message_id: messageId,
          user_id: userId,
          emoji: emoji
        }
      });
      io.to(conversationId).emit('reaction:add', { messageId, emoji, userId });
    }
  } catch (error) {
    console.error("Error al gestionar reacci贸n: ", error);
  }
});
  
  socket.on('message:read', ({ conversationId, readerId }) => {
    socket.to(conversationId).emit('message:read_update', { conversationId, readerId })
  })
  // 鉁?NUEVO: Evento para Editar Mensaje
  socket.on('message:edit', async ({ messageId, conversationId, newContent }) => {
    try {
      // 1. Actualizamos el texto en la base de datos
      await prisma.message.update({
        where: { id: messageId },
        data: { content: newContent, edited: true }
      })
      // 2. Le avisamos a todos en el chat que el texto cambi贸
      io.to(conversationId).emit('message:edit', { messageId, newContent })
    } catch (err) {
      console.error('Error al editar mensaje: ', err.message)
    }
  })

  // 鉁?NUEVO: Evento para Eliminar Mensaje (L贸gico)
  socket.on('message:delete', async ({ messageId, conversationId }) => {
    try {
      // 1. "Vaciamos" el mensaje en la base de datos para no dejar rastros
      await prisma.message.update({
        where: { id: messageId },
        data: { 
          content: '馃毇 Este mensaje fue eliminado',
          type: 'deleted',
          file_name: null,
          file_size: null
        }
      })
      // 2. Avisamos a todos para que su pantalla se actualice al instante
      io.to(conversationId).emit('message:delete', { messageId })
    } catch (err) {
      console.error('Error al eliminar mensaje: ', err.message)
    }
  })
  
  // 鉁?NUEVO: Evento para Reenviar Mensaje
  socket.on('message:forward', async ({ messageId, toConversationId, senderId }) => {
    try {
      // Buscamos el mensaje original
      const original = await prisma.message.findUnique({
        where: { id: messageId }
      })
      if (!original) return

      // Creamos una copia en la nueva conversaci贸n
      const msg = await prisma.message.create({
        data: {
          conversation_id: toConversationId,
          sender_id: senderId,
          content: original.content,
          type: original.type,
          file_name: original.file_name,
          file_size: original.file_size,
          forwarded_from: messageId
        }
      })

      // Buscamos los participantes del chat destino
      const conversation = await prisma.conversation.findUnique({
        where: { id: toConversationId },
        include: { members: true }
      })

      if (conversation) {
        const rooms = [toConversationId, ...conversation.members.map(m => m.user_id)]
        io.to(rooms).emit('message:new', { ...msg, sent: false, is_forwarded: true })
      }
    } catch (err) {
      console.error('Error reenviando mensaje: ', err.message)
    }
  })
  
  socket.on('profile:update', ({ userId, status, bio, avatar_url, avatar_color, name }) => {
    socket.broadcast.emit('profile:updated', { userId, status, bio, avatar_url, avatar_color, name })
  })

  // 鉁?LLAMADAS: Iniciar llamada
  socket.on('call:start', ({ toUserId, fromUserId, fromName, fromAvatar, callType, channelName }) => {
    io.to(toUserId).emit('call:incoming', { fromUserId, fromName, fromAvatar, callType, channelName })
  })

  // 鉁?LLAMADAS: Aceptar llamada
  socket.on('call:accept', ({ toUserId, callType }) => {
    io.to(toUserId).emit('call:accepted', { callType })
  })

  // 鉁?LLAMADAS: Rechazar llamada
  socket.on('call:reject', ({ toUserId }) => {
    io.to(toUserId).emit('call:rejected')
  })

  // 鉁?LLAMADAS: Colgar
  socket.on('call:end', ({ toUserId }) => {
    io.to(toUserId).emit('call:ended')
  })

  // 鉁?LLAMADAS: Subir de voz a video
  socket.on('call:upgrade', ({ toUserId }) => {
    io.to(toUserId).emit('call:upgrade')
  })

  // 鉁?LLAMADAS GRUPALES: Iniciar llamada a m煤ltiples usuarios
  socket.on('call:group_start', ({ toUserIds, fromUserId, fromName, fromAvatar, callType, conversationId }) => {
    toUserIds.forEach(uid => {
      io.to(uid).emit('call:group_incoming', { fromUserId, fromName, fromAvatar, callType, conversationId, allUserIds: [fromUserId, ...toUserIds] })
    })
  })

  // 鉁?LLAMADAS GRUPALES: Un miembro se une 鈥?avisa a todos los dem谩s
  socket.on('call:group_join', ({ toUserIds, fromUserId, callType }) => {
    toUserIds.forEach(uid => {
      io.to(uid).emit('call:group_peer_joined', { fromUserId, callType })
    })
  })

  // 鉁?LLAMADAS GRUPALES: Un miembro cuelga 鈥?avisa a los dem谩s (sin terminar la llamada)
  socket.on('call:group_leave', ({ toUserIds, fromUserId }) => {
    toUserIds.forEach(uid => {
      io.to(uid).emit('call:group_peer_left', { fromUserId })
    })
  })

  // 鉁?WebRTC: Se帽alizaci贸n
  socket.on('webrtc:offer', ({ toUserId, offer }) => {
    io.to(toUserId).emit('webrtc:offer', { offer, fromUserId: socket.id })
  })

  socket.on('webrtc:answer', ({ toUserId, answer }) => {
    io.to(toUserId).emit('webrtc:answer', { answer })
  })

  socket.on('webrtc:ice', ({ toUserId, candidate }) => {
    io.to(toUserId).emit('webrtc:ice', { candidate })
  })
   
  // Desconexi贸n
  socket.on('disconnect', async () => {
    const userId = await redisClient.hGet('socket_users', socket.id)

    if (userId) {
      await redisClient.hDel('user_sockets', userId)
      await redisClient.hDel('socket_users', socket.id)

      const onlineUsers = await redisClient.hKeys('user_sockets')
      io.emit('users:online', onlineUsers)
    }
    console.log('鉂?Socket desconectado: ', socket.id)
  })
})

const PORT = process.env.PORT || 3001

// 5. Encendemos Redis primero y luego el servidor
redisClient.connect().then(() => {
  console.log('馃煝 Conectado a Redis ')
  server.listen(PORT, () => {
    console.log(`馃殌 Servidor en puerto ${PORT} `)
  })
})
