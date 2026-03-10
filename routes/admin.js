const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { isAdmin } = require('../middleware/auth');
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
const upload = multer({ storage });

// Dashboard
router.get('/dashboard', isAdmin, (req, res) => {
  db.get("SELECT COUNT(*) as cnt FROM users WHERE role='user'", (e1, users) => {
    db.get("SELECT COUNT(*) as cnt FROM bookings", (e2, bookings) => {
      db.get("SELECT COUNT(*) as cnt FROM tourist_spots", (e3, spots) => {
        db.get("SELECT COUNT(*) as cnt FROM bookings WHERE status='pending'", (e4, pending) => {
          db.all("SELECT b.*, u.name as user_name FROM bookings b JOIN users u ON b.user_id=u.id ORDER BY b.created_at DESC LIMIT 10", (e5, recentBookings) => {
            res.render('admin/dashboard', {
              title: 'Admin Dashboard',
              stats: { users: users?.cnt || 0, bookings: bookings?.cnt || 0, spots: spots?.cnt || 0, pending: pending?.cnt || 0 },
              recentBookings: recentBookings || [],
              user: req.session.user
            });
          });
        });
      });
    });
  });
});

// Users
router.get('/users', isAdmin, (req, res) => {
  db.all("SELECT * FROM users ORDER BY created_at DESC", (err, users) => {
    res.render('admin/users', { title: 'Manage Users', users: users || [], user: req.session.user });
  });
});
router.post('/users/:id/delete', isAdmin, (req, res) => {
  db.run("DELETE FROM users WHERE id=? AND role != 'admin'", [req.params.id]);
  res.redirect('/admin/users');
});

// Bookings
router.get('/bookings', isAdmin, (req, res) => {
  db.all("SELECT b.*, u.name as user_name, u.email FROM bookings b JOIN users u ON b.user_id=u.id ORDER BY b.created_at DESC", (err, bookings) => {
    db.all(
      `SELECT er.*, b.item_name, b.check_in, b.persons, b.total_price, b.status as booking_status,
              owner.name as current_owner_name, owner.email as current_owner_email,
              req.name as requester_name, req.email as requester_email
       FROM exchange_requests er
       JOIN bookings b ON b.id = er.booking_id
       JOIN users owner ON owner.id = b.user_id
       JOIN users req ON req.id = er.requester_id
       WHERE er.status = 'pending'
       ORDER BY er.booking_id ASC, er.created_at ASC, er.id ASC`,
      (err2, exchangeRequests) => {
        res.render('admin/bookings', {
          title: 'Manage Bookings',
          bookings: bookings || [],
          exchangeRequests: exchangeRequests || [],
          user: req.session.user
        });
      }
    );
  });
});
router.post('/bookings/:id/status', isAdmin, (req, res) => {
  db.run("UPDATE bookings SET status=? WHERE id=?", [req.body.status, req.params.id]);
  res.redirect('/admin/bookings');
});

router.post('/exchange-requests/:id/approve', isAdmin, (req, res) => {
  req.flash('error', 'Admin approval is disabled. Ticket owner must accept or reject requests from the Transport page.');
  return res.redirect('/admin/bookings');
});

// Spots
router.get('/spots', isAdmin, (req, res) => {
  db.all("SELECT * FROM tourist_spots ORDER BY id DESC", (err, spots) => {
    res.render('admin/spots', { title: 'Manage Spots', spots: spots || [], user: req.session.user });
  });
});
router.post('/spots/add', isAdmin, upload.single('image'), (req, res) => {
  const { name, district, division, category, description, entry_fee, best_time } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : req.body.image_url || '';
  db.run("INSERT INTO tourist_spots (name, district, division, category, description, image, entry_fee, best_time) VALUES (?,?,?,?,?,?,?,?)",
    [name, district, division, category, description, image, entry_fee, best_time]);
  res.redirect('/admin/spots');
});
router.post('/spots/:id/delete', isAdmin, (req, res) => {
  db.run("DELETE FROM tourist_spots WHERE id=?", [req.params.id]);
  res.redirect('/admin/spots');
});
router.get('/spots/:id/edit', isAdmin, (req, res) => {
  db.get("SELECT * FROM tourist_spots WHERE id=?", [req.params.id], (err, spot) => {
    res.render('admin/spot-edit', { title: 'Edit Spot', spot, user: req.session.user });
  });
});
router.post('/spots/:id/edit', isAdmin, upload.single('image'), (req, res) => {
  const { name, district, division, category, description, entry_fee, best_time } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : req.body.current_image;
  db.run("UPDATE tourist_spots SET name=?, district=?, division=?, category=?, description=?, image=?, entry_fee=?, best_time=? WHERE id=?",
    [name, district, division, category, description, image, entry_fee, best_time, req.params.id]);
  res.redirect('/admin/spots');
});

// Hotels
router.get('/hotels', isAdmin, (req, res) => {
  db.all("SELECT * FROM hotels ORDER BY id DESC", (err, hotels) => {
    res.render('admin/hotels', { title: 'Manage Hotels', hotels: hotels || [], user: req.session.user });
  });
});
router.post('/hotels/add', isAdmin, upload.single('image'), (req, res) => {
  const { name, location, district, price_per_night, facilities, description, total_rooms, rating } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : req.body.image_url || '';
  db.run("INSERT INTO hotels (name, location, district, price_per_night, rating, facilities, description, image, total_rooms, available_rooms) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [name, location, district, price_per_night, rating || 0, facilities, description, image, total_rooms, total_rooms]);
  res.redirect('/admin/hotels');
});
router.get('/hotels/:id/edit', isAdmin, (req, res) => {
  db.get("SELECT * FROM hotels WHERE id=?", [req.params.id], (err, hotel) => {
    if (err || !hotel) return res.redirect('/admin/hotels');
    res.render('admin/hotel-edit', { title: 'Edit Hotel', hotel, user: req.session.user });
  });
});
router.post('/hotels/:id/edit', isAdmin, upload.single('image'), (req, res) => {
  const { name, location, district, price_per_night, rating, facilities, description, total_rooms, available_rooms, current_image } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : current_image;
  db.run(
    "UPDATE hotels SET name=?, location=?, district=?, price_per_night=?, rating=?, facilities=?, description=?, image=?, total_rooms=?, available_rooms=? WHERE id=?",
    [name, location, district, price_per_night, rating || 0, facilities, description, image, total_rooms, available_rooms, req.params.id]
  );
  res.redirect('/admin/hotels');
});
router.post('/hotels/:id/delete', isAdmin, (req, res) => {
  db.run("DELETE FROM hotels WHERE id=?", [req.params.id]);
  res.redirect('/admin/hotels');
});

// Guides
router.get('/guides', isAdmin, (req, res) => {
  db.all("SELECT * FROM guides ORDER BY id DESC", (err, guides) => {
    res.render('admin/guides', { title: 'Manage Guides', guides: guides || [], user: req.session.user });
  });
});
router.post('/guides/add', isAdmin, upload.single('image'), (req, res) => {
  const { name, specialty, languages, experience, rating, price_per_day, bio, phone, available } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : req.body.image_url || '';
  db.run(
    "INSERT INTO guides (name, specialty, languages, experience, rating, price_per_day, image, bio, phone, available) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [name, specialty, languages, experience, rating || 0, price_per_day, image, bio, phone, available ? 1 : 0]
  );
  res.redirect('/admin/guides');
});
router.get('/guides/:id/edit', isAdmin, (req, res) => {
  db.get("SELECT * FROM guides WHERE id=?", [req.params.id], (err, guide) => {
    if (err || !guide) return res.redirect('/admin/guides');
    res.render('admin/guide-edit', { title: 'Edit Guide', guide, user: req.session.user });
  });
});
router.post('/guides/:id/edit', isAdmin, upload.single('image'), (req, res) => {
  const { name, specialty, languages, experience, rating, price_per_day, bio, phone, available, current_image } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : current_image;
  db.run(
    "UPDATE guides SET name=?, specialty=?, languages=?, experience=?, rating=?, price_per_day=?, image=?, bio=?, phone=?, available=? WHERE id=?",
    [name, specialty, languages, experience, rating || 0, price_per_day, image, bio, phone, available ? 1 : 0, req.params.id]
  );
  res.redirect('/admin/guides');
});
router.post('/guides/:id/delete', isAdmin, (req, res) => {
  db.run("DELETE FROM guides WHERE id=?", [req.params.id]);
  res.redirect('/admin/guides');
});

// Packages
router.get('/packages', isAdmin, (req, res) => {
  db.all("SELECT * FROM packages ORDER BY id DESC", (err, packages) => {
    res.render('admin/packages', { title: 'Manage Packages', packages: packages || [], user: req.session.user });
  });
});
router.post('/packages/add', isAdmin, upload.single('image'), (req, res) => {
  const { name, destination, duration, price, includes, description, max_persons } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : req.body.image_url || '';
  db.run(
    "INSERT INTO packages (name, destination, duration, price, includes, image, description, max_persons) VALUES (?,?,?,?,?,?,?,?)",
    [name, destination, duration, price, includes, image, description, max_persons || 20]
  );
  res.redirect('/admin/packages');
});
router.get('/packages/:id/edit', isAdmin, (req, res) => {
  db.get("SELECT * FROM packages WHERE id=?", [req.params.id], (err, pkg) => {
    if (err || !pkg) return res.redirect('/admin/packages');
    res.render('admin/package-edit', { title: 'Edit Package', pkg, user: req.session.user });
  });
});
router.post('/packages/:id/edit', isAdmin, upload.single('image'), (req, res) => {
  const { name, destination, duration, price, includes, description, max_persons, current_image } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : current_image;
  db.run(
    "UPDATE packages SET name=?, destination=?, duration=?, price=?, includes=?, image=?, description=?, max_persons=? WHERE id=?",
    [name, destination, duration, price, includes, image, description, max_persons || 20, req.params.id]
  );
  res.redirect('/admin/packages');
});
router.post('/packages/:id/delete', isAdmin, (req, res) => {
  db.run("DELETE FROM packages WHERE id=?", [req.params.id]);
  res.redirect('/admin/packages');
});

// Upload Images
router.get('/uploads', isAdmin, (req, res) => {
  const uploadsDir = path.join(__dirname, '../public/uploads');
  let files = [];
  if (fs.existsSync(uploadsDir)) {
    files = fs.readdirSync(uploadsDir).map(f => ({ name: f, url: `/uploads/${f}` }));
  }
  res.render('admin/uploads', { title: 'Upload Images', files, user: req.session.user });
});
router.post('/uploads', isAdmin, upload.array('images', 10), (req, res) => {
  res.redirect('/admin/uploads');
});

module.exports = router;
