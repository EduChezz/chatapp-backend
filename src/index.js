require('dotenv').config()
const express = require('express')
const cors = require('cors')
const http = require('http')
const { Server } = require('socket.io')
const path = require('path')

// 1. Importamos prisma en lugar de pool y initDB
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

// Rutas
app.use('/api/auth', require('./routes/auth'))
app.use('/api/conversations', require('./routes/conversations'))
app.use('/api/messages', require('./routes/messages'))
app.use('/api/upload', require('./routes/upload'))

// WebSockets
const onlineUsers = new Map() // userId → socketId

io.on('connection', (socket) => {
  console.log('🔌 Socket conectado: - index.js:36', socket.id)

  // Usuario se conecta
  socket.on('user:join', (userId) => {
    onlineUsers.set(userId, socket.id)
    socket.join(userId)
    io.emit('users:online', Array.from(onlineUsers.keys()))
    console.log(`👤 Usuario ${userId} en línea - index.js:43`)
  })

  // Unirse a sala de conversación
  socket.on('conversation:join', (conversationId) => {
    socket.join(conversationId)
  })

  // Enviar mensaje en tiempo real
  socket.on('message:send', async (data) => {
    const { conversationId, senderId, content, type, fileName, fileSize } = data
    try {
      // 2. Guardamos el mensaje usando Prisma
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
      
      // Emitir a todos en la sala
      io.to(conversationId).emit('message:new', { ...msg, sent: false })
    } catch (err) {
      console.error('Error guardando mensaje: - index.js:70', err.message)
    }
  })

  // Indicador "escribiendo..."
  socket.on('typing:start', ({ conversationId, userName }) => {
    socket.to(conversationId).emit('typing:start', { userName })
  })

  socket.on('typing:stop', ({ conversationId }) => {
    socket.to(conversationId).emit('typing:stop')
  })

  // Reacción en tiempo real
  socket.on('reaction:add', ({ conversationId, messageId, emoji, userId }) => {
    io.to(conversationId).emit('reaction:add', { messageId, emoji, userId })
  })

  // Desconexión
  socket.on('disconnect', () => {
    for (const [userId, sid] of onlineUsers.entries()) {
      if (sid === socket.id) {
        onlineUsers.delete(userId)
        break
      }
    }
    io.emit('users:online', Array.from(onlineUsers.keys()))
    console.log('❌ Socket desconectado: - index.js:97', socket.id)
  })
})

// 3. Arrancar el servidor directamente sin initDB
const PORT = process.env.PORT || 3001
server.listen(PORT, () => {
  console.log(`🚀 Servidor en puerto ${PORT} - index.js:104`)
})