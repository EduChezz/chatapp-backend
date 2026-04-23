require('dotenv').config()
const express = require('express')
const cors = require('cors')
const http = require('http')
const { Server } = require('socket.io')
const path = require('path')
const { initDB, pool } = require('./config/db')

const app = express()
const server = http.createServer(app)
const io = new Server(server, {
  cors: { origin: 'http://localhost:5173', methods: ['GET', 'POST'] }
})

app.use(cors({ origin: 'http://localhost:5173' }))
app.use(express.json())
app.use('/uploads', express.static(path.join(__dirname, '../uploads')))

// Rutas
app.use('/api/auth', require('./routes/auth'))
app.use('/api/conversations', require('./routes/conversations'))
app.use('/api/messages', require('./routes/messages'))
app.use('/api/upload', require('./routes/upload'))

// WebSockets
const onlineUsers = new Map() // userId → socketId

io.on('connection', (socket) => {
  console.log('🔌 Socket conectado: - index.js:29', socket.id)

  // Usuario se conecta
  socket.on('user:join', (userId) => {
    onlineUsers.set(userId, socket.id)
    socket.join(userId)
    io.emit('users:online', Array.from(onlineUsers.keys()))
    console.log(`👤 Usuario ${userId} en línea - index.js:36`)
  })

  // Unirse a sala de conversación
  socket.on('conversation:join', (conversationId) => {
    socket.join(conversationId)
  })

  // Enviar mensaje en tiempo real
  socket.on('message:send', async (data) => {
    const { conversationId, senderId, content, type, fileName, fileSize } = data
    try {
      const result = await pool.query(
        'INSERT INTO messages (conversation_id, sender_id, content, type, file_name, file_size) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
        [conversationId, senderId, content, type || 'text', fileName || null, fileSize || null]
      )
      const msg = result.rows[0]
      // Emitir a todos en la sala
      io.to(conversationId).emit('message:new', { ...msg, sent: false })
    } catch (err) {
      console.error('Error guardando mensaje: - index.js:56', err.message)
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
    console.log('❌ Socket desconectado: - index.js:83', socket.id)
  })
})

// Arrancar
const PORT = process.env.PORT || 3001
initDB().then(() => {
  server.listen(PORT, () => console.log(`🚀 Servidor en http://localhost:${PORT} - index.js:90`))
})