const router = require('express').Router()
const multer = require('multer')
const { CloudinaryStorage } = require('multer-storage-cloudinary')
const cloudinary = require('cloudinary').v2
const auth = require('../middleware/auth')

// 1. Configurar Cloudinary con tus llaves secretas
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
})

// 2. Configurar el "disco duro" de Cloudinary
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'chatapp_uploads', // Así se llamará la carpeta dentro de tu Cloudinary
    allowed_formats: ['jpg', 'png', 'jpeg', 'gif', 'pdf', 'doc', 'docx', 'txt', 'zip'],
    resource_type: 'auto' // Permite que subas tanto imágenes como documentos
  }
})

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB máximo
})

// 3. La ruta para subir archivos
router.post('/', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' })
  
  // Cloudinary nos da la URL segura y pública automáticamente en req.file.path
  res.json({
    url: req.file.path,
    fileName: req.file.originalname,
    // Como Cloudinary maneja el tamaño distinto, le pasamos un valor estimado si no lo reporta directo
    fileSize: req.file.size ? (req.file.size / 1024).toFixed(1) + ' KB' : 'Desconocido',
    type: req.file.mimetype && req.file.mimetype.startsWith('image/') ? 'image' : 'file'
  })
})

module.exports = router