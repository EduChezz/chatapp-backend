require('dotenv').config()
const express = require('express')
const cors = require('cors')
const http = require('http')
const { Server } = require('socket.io')
const path = require('path')
const prisma = require('./config/db')

// 1. Importamos el cliente de Redis
const { createClient } = require('redis')

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

// Rutas
app.use('/api/auth', require('./routes/auth'))
app.use('/api/conversations', require('./routes/conversations'))
app.use('/api/messages', require('./routes/messages'))
app.use('/api/upload', require('./routes/upload'))

// 2. Configuramos la conexión a Redis
// 2. Configuramos la conexión a Redis
const redisClient = createClient({
  url: process.env.REDIS_URL,
  socket: {
    tls: true,
    rejectUnauthorized: false // Esto le dice a Node que confíe en el certificado de Upstash
  }
})

redisClient.on('error - index.js:43', (err) => console.log('❌ Error en Redis:', err))

// WebSockets con Redis
io.on('connection', (socket) => {
  console.log('🔌 Socket conectado: - index.js:47', socket.id)

  // Usuario se conecta
  socket.on('user:join', async (userId) => {
    // 3. Guardamos la conexión en la "bóveda" de Redis
    await redisClient.hSet('user_sockets', userId, socket.id)
    await redisClient.hSet('socket_users', socket.id, userId)

    // 🔥 CRUCIAL: El usuario se une a su "cuarto personal" usando su propio ID
    socket.join(userId)

    // Leemos quiénes están conectados directamente desde Redis
    const onlineUsers = await redisClient.hKeys('user_sockets')
    io.emit('users:online', onlineUsers)
    console.log(`👤 Usuario ${userId} en línea - index.js:61`)
  })

  socket.on('conversation:join', (conversationId) => {
    socket.join(conversationId)
  })

  // 🔥 AQUÍ ESTÁ LA MAGIA DEL TIMBRAZO PERSONAL
  socket.on('message:send', async (data) => {
    const { conversationId, senderId, content, type, fileName, fileSize } = data
    try {
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
        
        // io.to(lista) envía el mensaje a todos. Socket.io es tan inteligente que 
        // si alguien está en ambos cuartos, NO le duplica el mensaje. ¡Pura magia!
        io.to(rooms).emit('message:new', { ...msg, sent: false })
      } else {
        io.to(conversationId).emit('message:new', { ...msg, sent: false })
      }

    } catch (err) {
      console.error('Error guardando mensaje: - index.js:102', err.message)
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
    // 1. Verificar si la reacción ya existe (Toggle)
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
    console.error("Error al gestionar reacción: - index.js:143", error);
  }
});
  
  socket.on('message:read', ({ conversationId, readerId }) => {
    socket.to(conversationId).emit('message:read_update', { conversationId, readerId })
  })
  // ✨ NUEVO: Evento para Editar Mensaje
  socket.on('message:edit', async ({ messageId, conversationId, newContent }) => {
    try {
      // 1. Actualizamos el texto en la base de datos
      await prisma.message.update({
        where: { id: messageId },
        data: { content: newContent }
      })
      // 2. Le avisamos a todos en el chat que el texto cambió
      io.to(conversationId).emit('message:edit', { messageId, newContent })
    } catch (err) {
      console.error('Error al editar mensaje: - index.js:161', err.message)
    }
  })

  // ✨ NUEVO: Evento para Eliminar Mensaje (Lógico)
  socket.on('message:delete', async ({ messageId, conversationId }) => {
    try {
      // 1. "Vaciamos" el mensaje en la base de datos para no dejar rastros
      await prisma.message.update({
        where: { id: messageId },
        data: { 
          content: '🚫 Este mensaje fue eliminado',
          type: 'deleted',
          file_name: null,
          file_size: null
        }
      })
      // 2. Avisamos a todos para que su pantalla se actualice al instante
      io.to(conversationId).emit('message:delete', { messageId })
    } catch (err) {
      console.error('Error al eliminar mensaje: - index.js:181', err.message)
    }
  })
  
  // Desconexión
  socket.on('disconnect', async () => {
    const userId = await redisClient.hGet('socket_users', socket.id)

    if (userId) {
      await redisClient.hDel('user_sockets', userId)
      await redisClient.hDel('socket_users', socket.id)

      const onlineUsers = await redisClient.hKeys('user_sockets')
      io.emit('users:online', onlineUsers)
    }
    console.log('❌ Socket desconectado: - index.js:196', socket.id)
  })
})

const PORT = process.env.PORT || 3001

// 5. Encendemos Redis primero y luego el servidor
redisClient.connect().then(() => {
  console.log('🟢 Conectado a Redis - index.js:204')
  server.listen(PORT, () => {
    console.log(`🚀 Servidor en puerto ${PORT} - index.js:206`)
  })
})