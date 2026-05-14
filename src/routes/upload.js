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
    folder: 'chatapp_uploads',
    // ✨ AÑADIMOS webm, mp3, wav, ogg y m4a para permitir los audios
    allowed_formats: ['jpg', 'png', 'jpeg', 'gif', 'pdf', 'doc', 'docx', 'txt', 'zip', 'webm', 'mp3', 'wav', 'ogg', 'm4a'],
    resource_type: 'auto' 
  }
})

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB máximo
})

// 3. La ruta para subir archivos
router.post('/', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' })
  
  // ✨ NUEVO: Mejoramos la detección del tipo de archivo
  let fileType = 'file'
  if (req.file.mimetype) {
    if (req.file.mimetype.startsWith('image/')) fileType = 'image'
    else if (req.file.mimetype.startsWith('audio/') || req.file.mimetype.startsWith('video/')) fileType = 'audio'
  }

  // Cloudinary nos da la URL segura y pública automáticamente en req.file.path
  res.json({
    url: req.file.path,
    fileName: req.file.originalname,
    fileSize: req.file.size ? (req.file.size / 1024).toFixed(1) + ' KB' : 'Desconocido',
    type: fileType
  })
})

module.exports = router