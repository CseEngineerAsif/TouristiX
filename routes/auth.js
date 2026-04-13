const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const { isGuest, isAuth } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../public/uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowedExt = ['.jpg', '.jpeg', '.png', '.pdf'];
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!allowedExt.includes(ext)) return cb(new Error('Only JPG, PNG, and PDF files are allowed.'));
    cb(null, true);
  }
});

router.get('/login', isGuest, (req, res) => {
  res.render('auth/login', { title: 'Login', error: req.flash('error'), success: req.flash('success') });
});

router.post('/login', isGuest, (req, res) => {
  const { email, password } = req.body;
  db.get("SELECT * FROM users WHERE email = ?", [email], (err, user) => {
    if (!user || !bcrypt.compareSync(password, user.password)) {
      req.flash('error', 'Invalid email or password.');
      return res.redirect('/auth/login');
    }
    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      gender: user.gender || ''
    };
    if (user.role === 'admin') return res.redirect('/admin/dashboard');
    res.redirect('/');
  });
});

router.get('/register', isGuest, (req, res) => {
  res.render('auth/register', { title: 'Register', error: req.flash('error') });
});

router.post('/register', isGuest, upload.single('id_document'), (req, res) => {
  const { name, email, password, phone, address, id_type, gender } = req.body;
  const idDocument = req.file ? `/uploads/${req.file.filename}` : '';

  if (!id_type || !idDocument) {
    req.flash('error', 'Please select an ID type and upload the ID document.');
    return res.redirect('/auth/register');
  }

  db.get("SELECT id FROM users WHERE email = ?", [email], (err, existing) => {
    if (existing) {
      req.flash('error', 'Email already registered.');
      return res.redirect('/auth/register');
    }
    const hash = bcrypt.hashSync(password, 10);
    db.run(
      "INSERT INTO users (name, email, password, phone, address, id_type, id_document, gender) VALUES (?,?,?,?,?,?,?,?)",
      [name, email, hash, phone, address, id_type, idDocument, gender || ''],
      function(err) {
      if (err) { req.flash('error', 'Registration failed.'); return res.redirect('/auth/register'); }
      req.flash('success', 'Account created! Please login.');
      res.redirect('/auth/login');
      }
    );
  });
});

router.get('/logout', isAuth, (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err) {
    req.flash('error', err.message || 'File upload failed.');
    return res.redirect('/auth/register');
  }
  next(err);
});

module.exports = router;
