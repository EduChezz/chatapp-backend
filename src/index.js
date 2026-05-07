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
const redisClient = createClient({
  url: process.env.REDIS_URL
})

redisClient.on('error - index.js:38', (err) => console.log('❌ Error en Redis:', err))

// WebSockets con Redis
io.on('connection', (socket) => {
  console.log('🔌 Socket conectado: - index.js:42', socket.id)

  // Usuario se conecta
  socket.on('user:join', async (userId) => {
    // 3. Guardamos la conexión en la "bóveda" de Redis
    await redisClient.hSet('user_sockets', userId, socket.id)
    await redisClient.hSet('socket_users', socket.id, userId)

    socket.join(userId)

    // Leemos quiénes están conectados directamente desde Redis
    const onlineUsers = await redisClient.hKeys('user_sockets')
    io.emit('users:online', onlineUsers)
    console.log(`👤 Usuario ${userId} en línea - index.js:55`)
  })

  socket.on('conversation:join', (conversationId) => {
    socket.join(conversationId)
  })

  socket.on('message:send', async (data) => {
    const { conversationId, senderId, content, type, fileName, fileSize } = data
    try {
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
      io.to(conversationId).emit('message:new', { ...msg, sent: false })
    } catch (err) {
      console.error('Error guardando mensaje: - index.js:77', err.message)
    }
  })

  socket.on('typing:start', ({ conversationId, userName }) => {
    socket.to(conversationId).emit('typing:start', { userName })
  })

  socket.on('typing:stop', ({ conversationId }) => {
    socket.to(conversationId).emit('typing:stop')
  })

  socket.on('reaction:add', ({ conversationId, messageId, emoji, userId }) => {
    io.to(conversationId).emit('reaction:add', { messageId, emoji, userId })
  })
  
  socket.on('message:read', ({ conversationId, readerId }) => {
    socket.to(conversationId).emit('message:read_update', { conversationId, readerId })
  })
  
  // Desconexión
  socket.on('disconnect', async () => {
    // 4. Buscamos en Redis quién era el dueño de este socket y lo borramos
    const userId = await redisClient.hGet('socket_users', socket.id)

    if (userId) {
      await redisClient.hDel('user_sockets', userId)
      await redisClient.hDel('socket_users', socket.id)

      const onlineUsers = await redisClient.hKeys('user_sockets')
      io.emit('users:online', onlineUsers)
    }
    console.log('❌ Socket desconectado: - index.js:109', socket.id)
  })
})

const PORT = process.env.PORT || 3001

// 5. Encendemos Redis primero y luego el servidor
redisClient.connect().then(() => {
  console.log('🟢 Conectado a Redis - index.js:117')
  server.listen(PORT, () => {
    console.log(`🚀 Servidor en puerto ${PORT} - index.js:119`)
  })
})