const router = require('express').Router()
const multer = require('multer')
const path = require('path')
const auth = require('../middleware/auth')

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9)
    cb(null, unique + path.extname(file.originalname))
  }
})

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB máx
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|pdf|doc|docx|txt|zip/
    const ext = allowed.test(path.extname(file.originalname).toLowerCase())
    ext ? cb(null, true) : cb(new Error('Tipo de archivo no permitido'))
  }
})

router.post('/', auth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' })
  const url = `http://localhost:${process.env.PORT || 3001}/uploads/${req.file.filename}`
  res.json({
    url,
    fileName: req.file.originalname,
    fileSize: (req.file.size / 1024).toFixed(1) + ' KB',
    type: req.file.mimetype.startsWith('image/') ? 'image' : 'file'
  })
})

module.exports = router