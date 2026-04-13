const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const { isProvider, isProviderGuest } = require('../middleware/auth');

const router = express.Router();

function roleFromType(type) {
  const value = String(type || '').toLowerCase();
  if (value === 'hotel') return 'owner_hotel';
  if (value === 'transport') return 'owner_transport';
  if (value === 'guide') return 'owner_guide';
  if (value === 'package') return 'owner_package';
  return null;
}

function typeFromRole(role) {
  if (role === 'owner_hotel') return 'hotel';
  if (role === 'owner_transport') return 'transport';
  if (role === 'owner_guide') return 'guide';
  if (role === 'owner_package') return 'package';
  return null;
}

router.get('/login', isProviderGuest, (req, res) => {
  res.redirect('/auth/login?tab=partner');
});

router.post('/login', isProviderGuest, (req, res) => {
  const { email, password } = req.body;
  db.get("SELECT * FROM users WHERE email = ?", [email], (err, user) => {
    const role = user?.role;
    const isProviderRole = role === 'owner_hotel' || role === 'owner_transport' || role === 'owner_guide' || role === 'owner_package';
    if (!user || !isProviderRole || !bcrypt.compareSync(password, user.password)) {
      req.flash('error', 'Invalid partner email or password.');
      return res.redirect('/partner/login');
    }
    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar || ''
    };
    return res.redirect('/partner/dashboard');
  });
});

router.get('/register', isProviderGuest, (req, res) => {
  res.redirect('/auth/register?tab=partner');
});

router.post('/register', isProviderGuest, (req, res) => {
  const { name, email, password, phone, provider_type } = req.body;
  const role = roleFromType(provider_type);
  if (!role) {
    req.flash('error', 'Please choose a valid partner type.');
    return res.redirect('/partner/register');
  }
  if (!name || !email || !password) {
    req.flash('error', 'Please complete all required fields.');
    return res.redirect('/partner/register');
  }
  db.get("SELECT id FROM users WHERE email = ?", [email], (err, existing) => {
    if (existing) {
      req.flash('error', 'Email already registered.');
      return res.redirect('/partner/register');
    }
    const hash = bcrypt.hashSync(password, 10);
    db.run(
      "INSERT INTO users (name, email, password, phone, role) VALUES (?,?,?,?,?)",
      [name, email, hash, phone || '', role],
      function (insertErr) {
        if (insertErr) {
          req.flash('error', 'Registration failed. Please try again.');
          return res.redirect('/partner/register');
        }
        req.flash('success', 'Partner account created! Please login.');
        return res.redirect('/partner/login');
      }
    );
  });
});

router.get('/dashboard', isProvider, (req, res) => {
  const providerType = typeFromRole(req.session.user.role);
  const uid = req.session.user.id;

  const renderDashboard = (items, bookings) => {
    res.render('provider/dashboard', {
      title: 'Partner Dashboard',
      providerType,
      items: items || [],
      bookings: bookings || [],
      user: req.session.user
    });
  };

  if (providerType === 'hotel') {
    db.all("SELECT * FROM hotels WHERE owner_user_id=? ORDER BY id DESC", [uid], (err, hotels) => {
      db.all(
        `SELECT b.*, e.status as escrow_status
         FROM bookings b
         JOIN hotels h ON h.id = b.item_id
         LEFT JOIN escrow_payments e ON e.booking_id = b.id
         WHERE b.type='hotel' AND h.owner_user_id=?
         ORDER BY b.created_at DESC`,
        [uid],
        (err2, bookings) => renderDashboard(hotels, bookings)
      );
    });
    return;
  }

  if (providerType === 'transport') {
    db.all("SELECT * FROM transport WHERE owner_user_id=? ORDER BY id DESC", [uid], (err, transports) => {
      db.all(
        `SELECT b.*, e.status as escrow_status
         FROM bookings b
         JOIN transport t ON t.id = b.item_id
         LEFT JOIN escrow_payments e ON e.booking_id = b.id
         WHERE b.type='transport' AND t.owner_user_id=?
         ORDER BY b.created_at DESC`,
        [uid],
        (err2, bookings) => renderDashboard(transports, bookings)
      );
    });
    return;
  }

  if (providerType === 'guide') {
    db.all("SELECT * FROM guides WHERE owner_user_id=? ORDER BY id DESC", [uid], (err, guides) => {
      db.all(
        `SELECT b.*, e.status as escrow_status
         FROM bookings b
         JOIN guides g ON g.id = b.item_id
         LEFT JOIN escrow_payments e ON e.booking_id = b.id
         WHERE b.type='guide' AND g.owner_user_id=?
         ORDER BY b.created_at DESC`,
        [uid],
        (err2, bookings) => renderDashboard(guides, bookings)
      );
    });
    return;
  }

  db.all("SELECT * FROM packages WHERE owner_user_id=? ORDER BY id DESC", [uid], (err, packages) => {
    db.all(
      `SELECT b.*, e.status as escrow_status
       FROM bookings b
       JOIN packages p ON p.id = b.item_id
       LEFT JOIN escrow_payments e ON e.booking_id = b.id
       WHERE b.type='package' AND p.owner_user_id=?
       ORDER BY b.created_at DESC`,
      [uid],
      (err2, bookings) => renderDashboard(packages, bookings)
    );
  });
});

router.post('/bookings/:id/complete', isProvider, (req, res) => {
  const bookingId = req.params.id;
  const uid = req.session.user.id;
  const providerType = typeFromRole(req.session.user.role);

  let joinTable = 'hotels';
  if (providerType === 'transport') joinTable = 'transport';
  if (providerType === 'guide') joinTable = 'guides';
  if (providerType === 'package') joinTable = 'packages';

  db.get(
    `SELECT b.id
     FROM bookings b
     JOIN ${joinTable} x ON x.id = b.item_id
     WHERE b.id = ? AND b.type = ? AND x.owner_user_id = ?`,
    [bookingId, providerType, uid],
    (err, booking) => {
      if (err || !booking) {
        req.flash('error', 'Booking not found for your account.');
        return res.redirect('/partner/dashboard');
      }
      db.run(
        "UPDATE bookings SET status='completed', escrow_status='ready' WHERE id=?",
        [bookingId],
        (updateErr) => {
          if (updateErr) {
            req.flash('error', 'Could not mark booking as completed.');
            return res.redirect('/partner/dashboard');
          }
          req.flash('success', 'Booking marked as completed. Awaiting admin release.');
          return res.redirect('/partner/dashboard');
        }
      );
    }
  );
});

router.get('/logout', isProvider, (req, res) => {
  req.session.destroy();
  res.redirect('/auth/login?tab=partner');
});

module.exports = router;
