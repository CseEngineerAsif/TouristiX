require('dotenv').config();
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));
app.use(session({
  secret: process.env.SESSION_SECRET || 'touristix-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));
app.use(flash());

// Global locals
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.success_msg = req.flash('success');
  res.locals.error_msg = req.flash('error');
  next();
});

// Routes
app.use('/', require('./routes/user'));
app.use('/auth', require('./routes/auth'));
app.use('/admin', require('./routes/admin'));
app.use('/partner', require('./routes/provider'));
app.use('/provider', require('./routes/provider'));

// 404
app.use((req, res) => {
  res.status(404).render('user/home', { title: 'Home', spots: [], packages: [], user: req.session.user });
});

app.listen(PORT, () => {
  console.log(`\n🚀 TouristiX running at http://localhost:${PORT}`);
  console.log(`📱 Open in browser: http://localhost:${PORT}`);
  console.log(`🔐 Admin login: admin@touristix.com / admin123`);
  console.log(`📊 Admin panel: http://localhost:${PORT}/admin/dashboard\n`);
});
