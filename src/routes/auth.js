const router = require('express').Router()
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
// Importamos nuestra nueva conexión de Prisma en lugar de "pool"
const prisma = require('../config/db')

// Registro
router.post('/register', async (req, res) => {
  const { name, email, password } = req.body
  if (!name || !email || !password)
    return res.status(400).json({ error: 'Todos los campos son requeridos' })

  try {
    // Buscar si el correo ya existe
    const exists = await prisma.user.findUnique({ where: { email } })
    if (exists)
      return res.status(400).json({ error: 'El email ya está registrado' })

    // Encriptar la contraseña
    const hash = await bcrypt.hash(password, 10)
    
    // Crear el nuevo usuario
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password: hash
      },
      // Le decimos a Prisma qué datos queremos que nos devuelva (excluyendo la contraseña)
      select: { id: true, name: true, email: true, avatar_color: true, bio: true, status: true }
    })

    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' })
    res.status(201).json({ token, user })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body
  try {
    // Buscar el usuario
    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) return res.status(400).json({ error: 'Credenciales incorrectas' })

    // Verificar la contraseña
    const valid = await bcrypt.compare(password, user.password)
    if (!valid) return res.status(400).json({ error: 'Credenciales incorrectas' })

    const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' })
    const { password: _, ...userData } = user
    res.json({ token, user: userData })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Actualizar perfil
router.put('/profile', require('../middleware/auth'), async (req, res) => {
  const { name, bio, avatar_color, status } = req.body
  try {
    // Actualizar los datos del usuario logueado
    const user = await prisma.user.update({
      where: { id: req.user.id },
      data: { name, bio, avatar_color, status },
      select: { id: true, name: true, email: true, avatar_color: true, bio: true, status: true }
    })
    res.json(user)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router