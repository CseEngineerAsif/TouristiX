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

function withTransaction(work, done) {
  db.serialize(() => {
    db.run("BEGIN IMMEDIATE TRANSACTION", (beginErr) => {
      if (beginErr) return done(beginErr);
      work((workErr) => {
        if (workErr) {
          return db.run("ROLLBACK", () => done(workErr));
        }
        db.run("COMMIT", (commitErr) => {
          if (commitErr) {
            return db.run("ROLLBACK", () => done(commitErr));
          }
          return done(null);
        });
      });
    });
  });
}

function generateCouponCode() {
  const part = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `BLOG-${Date.now().toString().slice(-6)}-${part}`;
}

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

// Blogs
router.get('/blogs', isAdmin, (req, res) => {
  db.all(
    `SELECT bp.*, u.name as author_name, u.email as author_email, c.code as reward_coupon_code
     FROM blog_posts bp
     JOIN users u ON u.id = bp.user_id
     LEFT JOIN coupons c ON c.id = bp.reward_coupon_id
     ORDER BY CASE WHEN bp.status='pending' THEN 0 ELSE 1 END, bp.created_at DESC`,
    (err, posts) => {
      res.render('admin/blogs', {
        title: 'Manage Blogs',
        posts: posts || [],
        user: req.session.user
      });
    }
  );
});

router.post('/blogs/:id/approve', isAdmin, (req, res) => {
  const blogId = req.params.id;
  db.get("SELECT * FROM blog_posts WHERE id=?", [blogId], (err, post) => {
    if (err || !post) {
      req.flash('error', 'Blog post not found.');
      return res.redirect('/admin/blogs');
    }
    if (post.status === 'approved') {
      req.flash('success', 'Blog post is already approved.');
      return res.redirect('/admin/blogs');
    }

    const couponCode = generateCouponCode();
    withTransaction((finish) => {
      db.run(
        `INSERT INTO coupons (user_id, code, discount_type, discount_value, max_discount, min_order_amount, status, reward_source, reward_ref_id, note, expires_at)
         VALUES (?, ?, 'percent', 10, 500, 500, 'active', 'blog_post', ?, 'Reward coupon for approved blog post', datetime('now', '+30 days'))`,
        [post.user_id, couponCode, blogId],
        function (couponErr) {
          if (couponErr) return finish(couponErr);
          db.run(
            "UPDATE blog_posts SET status='approved', approved_at=CURRENT_TIMESTAMP, approved_by=?, rejection_note=NULL, reward_coupon_id=? WHERE id=?",
            [req.session.user.id, this.lastID, blogId],
            (updateErr) => finish(updateErr || null)
          );
        }
      );
    }, (txErr) => {
      if (txErr) {
        req.flash('error', 'Could not approve blog post.');
        return res.redirect('/admin/blogs');
      }
      req.flash('success', `Blog approved and reward coupon created: ${couponCode}`);
      return res.redirect('/admin/blogs');
    });
  });
});

router.post('/blogs/:id/reject', isAdmin, (req, res) => {
  const blogId = req.params.id;
  const rejectionNote = String(req.body.rejection_note || '').trim();
  db.run(
    "UPDATE blog_posts SET status='rejected', approved_at=NULL, approved_by=?, rejection_note=?, reward_coupon_id=NULL WHERE id=?",
    [req.session.user.id, rejectionNote || 'Rejected by admin.', blogId],
    function (err) {
      if (err || this.changes === 0) {
        req.flash('error', 'Could not reject blog post.');
        return res.redirect('/admin/blogs');
      }
      req.flash('success', 'Blog post rejected.');
      return res.redirect('/admin/blogs');
    }
  );
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
  const nextStatus = String(req.body.status || '').toLowerCase();
  if (!['pending', 'confirmed', 'completed', 'cancelled'].includes(nextStatus)) {
    req.flash('error', 'Invalid booking status.');
    return res.redirect('/admin/bookings');
  }
  db.get("SELECT id, status FROM bookings WHERE id=?", [req.params.id], (err, booking) => {
    if (err || !booking) {
      req.flash('error', 'Booking not found.');
      return res.redirect('/admin/bookings');
    }
    if (booking.status === nextStatus) {
      req.flash('success', `Booking already ${nextStatus}.`);
      return res.redirect('/admin/bookings');
    }
    if (booking.status === 'cancelled' || booking.status === 'completed') {
      req.flash('error', `${booking.status.charAt(0).toUpperCase() + booking.status.slice(1)} bookings cannot be changed.`);
      return res.redirect('/admin/bookings');
    }
    db.run("UPDATE bookings SET status=? WHERE id=?", [nextStatus, req.params.id], (updateErr) => {
      if (updateErr) {
        req.flash('error', 'Could not update booking status.');
        return res.redirect('/admin/bookings');
      }
      req.flash('success', `Booking ${nextStatus} successfully.`);
      return res.redirect('/admin/bookings');
    });
  });
});

router.post('/exchange-requests/:id/approve', isAdmin, (req, res) => {
  req.flash('error', 'Admin approval is disabled. Ticket owner must accept or reject requests from the Transport page.');
  return res.redirect('/admin/bookings');
});

// Payout ledger
router.get('/payouts', isAdmin, (req, res) => {
  db.all(
    `SELECT e.*, b.item_name, b.type as booking_type, b.status as booking_status, b.escrow_status as booking_escrow_status,
            payer.name as payer_name, payer.email as payer_email,
            provider.name as provider_name, provider.email as provider_email
     FROM escrow_payments e
     JOIN bookings b ON b.id = e.booking_id
     JOIN users payer ON payer.id = e.payer_id
     LEFT JOIN users provider ON provider.id = e.provider_user_id
     ORDER BY e.created_at DESC`,
    (err, payouts) => {
      const rows = payouts || [];
      const stats = rows.reduce((acc, row) => {
        const amount = Number(row.amount || 0);
        const commission = Number(row.provider_commission_amount || 0);
        const partnerGets = Math.max(0, amount - commission);
        if (String(row.status || '').toLowerCase() === 'refunded') {
          acc.refunded += 1;
        } else {
          acc.paidOut += 1;
        }
        acc.totalVolume += amount;
        acc.totalCommission += commission;
        acc.totalPartnerPayout += partnerGets;
        return acc;
      }, {
        paidOut: 0,
        refunded: 0,
        totalVolume: 0,
        totalCommission: 0,
        totalPartnerPayout: 0
      });

      res.render('admin/payouts', {
        title: 'Manage Payouts',
        payouts: rows,
        stats,
        user: req.session.user
      });
    }
  );
});

router.post('/payouts/:id/release', isAdmin, (req, res) => {
  req.flash('error', 'Manual payout release is no longer needed. Booking payments now split instantly between partner and admin.');
  return res.redirect('/admin/payouts');
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
    db.all("SELECT id, name, email FROM users WHERE role='owner_hotel' AND email NOT IN ('partner@gmail.com', 'partner2@gmail.com') ORDER BY name ASC", (err2, owners) => {
      res.render('admin/hotels', { title: 'Manage Hotels', hotels: hotels || [], owners: owners || [], user: req.session.user });
    });
  });
});
router.post('/hotels/add', isAdmin, upload.single('image'), (req, res) => {
  const { name, location, district, price_per_night, facilities, description, total_rooms, rating, owner_user_id } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : req.body.image_url || '';
  db.run("INSERT INTO hotels (name, location, district, price_per_night, rating, facilities, description, image, total_rooms, available_rooms) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [name, location, district, price_per_night, rating || 0, facilities, description, image, total_rooms, total_rooms], function () {
      if (owner_user_id) {
        db.run("UPDATE hotels SET owner_user_id=? WHERE id=?", [owner_user_id, this.lastID]);
      }
    });
  res.redirect('/admin/hotels');
});
router.get('/hotels/:id/edit', isAdmin, (req, res) => {
  db.get("SELECT * FROM hotels WHERE id=?", [req.params.id], (err, hotel) => {
    if (err || !hotel) return res.redirect('/admin/hotels');
    db.all("SELECT id, name, email FROM users WHERE role='owner_hotel' AND email NOT IN ('partner@gmail.com', 'partner2@gmail.com') ORDER BY name ASC", (err2, owners) => {
      res.render('admin/hotel-edit', { title: 'Edit Hotel', hotel, owners: owners || [], user: req.session.user });
    });
  });
});
router.post('/hotels/:id/edit', isAdmin, upload.single('image'), (req, res) => {
  const { name, location, district, price_per_night, rating, facilities, description, total_rooms, available_rooms, current_image, owner_user_id } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : current_image;
  db.run(
    "UPDATE hotels SET name=?, location=?, district=?, price_per_night=?, rating=?, facilities=?, description=?, image=?, total_rooms=?, available_rooms=?, owner_user_id=? WHERE id=?",
    [name, location, district, price_per_night, rating || 0, facilities, description, image, total_rooms, available_rooms, owner_user_id || null, req.params.id]
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
    db.all("SELECT id, name, email FROM users WHERE role='owner_guide' AND email NOT IN ('partner@gmail.com', 'partner2@gmail.com') ORDER BY name ASC", (err2, owners) => {
      res.render('admin/guides', { title: 'Manage Guides', guides: guides || [], owners: owners || [], user: req.session.user });
    });
  });
});
router.post('/guides/add', isAdmin, upload.single('image'), (req, res) => {
  const { name, specialty, languages, experience, rating, price_per_day, bio, phone, available, owner_user_id } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : req.body.image_url || '';
  db.run(
    "INSERT INTO guides (name, specialty, languages, experience, rating, price_per_day, image, bio, phone, available) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [name, specialty, languages, experience, rating || 0, price_per_day, image, bio, phone, available ? 1 : 0],
    function () {
      if (owner_user_id) {
        db.run("UPDATE guides SET owner_user_id=? WHERE id=?", [owner_user_id, this.lastID]);
      }
    }
  );
  res.redirect('/admin/guides');
});
router.get('/guides/:id/edit', isAdmin, (req, res) => {
  db.get("SELECT * FROM guides WHERE id=?", [req.params.id], (err, guide) => {
    if (err || !guide) return res.redirect('/admin/guides');
    db.all("SELECT id, name, email FROM users WHERE role='owner_guide' AND email NOT IN ('partner@gmail.com', 'partner2@gmail.com') ORDER BY name ASC", (err2, owners) => {
      res.render('admin/guide-edit', { title: 'Edit Guide', guide, owners: owners || [], user: req.session.user });
    });
  });
});
router.post('/guides/:id/edit', isAdmin, upload.single('image'), (req, res) => {
  const { name, specialty, languages, experience, rating, price_per_day, bio, phone, available, current_image, owner_user_id } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : current_image;
  db.run(
    "UPDATE guides SET name=?, specialty=?, languages=?, experience=?, rating=?, price_per_day=?, image=?, bio=?, phone=?, available=?, owner_user_id=? WHERE id=?",
    [name, specialty, languages, experience, rating || 0, price_per_day, image, bio, phone, available ? 1 : 0, owner_user_id || null, req.params.id]
  );
  res.redirect('/admin/guides');
});
router.post('/guides/:id/delete', isAdmin, (req, res) => {
  db.run("DELETE FROM guides WHERE id=?", [req.params.id]);
  res.redirect('/admin/guides');
});

// Transport
router.get('/transport', isAdmin, (req, res) => {
  db.all("SELECT * FROM transport ORDER BY id DESC", (err, transports) => {
    db.all("SELECT id, name, email FROM users WHERE role='owner_transport' AND email NOT IN ('partner@gmail.com', 'partner2@gmail.com') ORDER BY name ASC", (err2, owners) => {
      res.render('admin/transports', { title: 'Manage Transport', transports: transports || [], owners: owners || [], user: req.session.user });
    });
  });
});
router.post('/transport/add', isAdmin, upload.single('image'), (req, res) => {
  const { type, company, from_location, to_location, departure_time, price, seats_available, owner_user_id } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : req.body.image_url || '';
  db.run(
    "INSERT INTO transport (type, company, from_location, to_location, departure_time, price, seats_available, image) VALUES (?,?,?,?,?,?,?,?)",
    [type, company, from_location, to_location, departure_time, price, seats_available || 40, image],
    function () {
      if (owner_user_id) {
        db.run("UPDATE transport SET owner_user_id=? WHERE id=?", [owner_user_id, this.lastID]);
      }
    }
  );
  res.redirect('/admin/transport');
});
router.get('/transport/:id/edit', isAdmin, (req, res) => {
  db.get("SELECT * FROM transport WHERE id=?", [req.params.id], (err, transport) => {
    if (err || !transport) return res.redirect('/admin/transport');
    db.all("SELECT id, name, email FROM users WHERE role='owner_transport' AND email NOT IN ('partner@gmail.com', 'partner2@gmail.com') ORDER BY name ASC", (err2, owners) => {
      res.render('admin/transport-edit', { title: 'Edit Transport', transport, owners: owners || [], user: req.session.user });
    });
  });
});
router.post('/transport/:id/edit', isAdmin, upload.single('image'), (req, res) => {
  const { type, company, from_location, to_location, departure_time, price, seats_available, current_image, owner_user_id } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : current_image;
  db.run(
    "UPDATE transport SET type=?, company=?, from_location=?, to_location=?, departure_time=?, price=?, seats_available=?, image=?, owner_user_id=? WHERE id=?",
    [type, company, from_location, to_location, departure_time, price, seats_available, image, owner_user_id || null, req.params.id]
  );
  res.redirect('/admin/transport');
});
router.post('/transport/:id/delete', isAdmin, (req, res) => {
  db.run("DELETE FROM transport WHERE id=?", [req.params.id]);
  res.redirect('/admin/transport');
});

// Packages
router.get('/packages', isAdmin, (req, res) => {
  db.all("SELECT * FROM packages ORDER BY id DESC", (err, packages) => {
    db.all("SELECT id, name, email FROM users WHERE role='owner_package' AND email NOT IN ('partner@gmail.com', 'partner2@gmail.com') ORDER BY name ASC", (err2, owners) => {
      res.render('admin/packages', { title: 'Manage Packages', packages: packages || [], owners: owners || [], user: req.session.user });
    });
  });
});
router.post('/packages/add', isAdmin, upload.single('image'), (req, res) => {
  const { name, destination, duration, price, includes, description, max_persons, owner_user_id } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : req.body.image_url || '';
  db.run(
    "INSERT INTO packages (name, destination, duration, price, includes, image, description, max_persons) VALUES (?,?,?,?,?,?,?,?)",
    [name, destination, duration, price, includes, image, description, max_persons || 20],
    function () {
      if (owner_user_id) {
        db.run("UPDATE packages SET owner_user_id=? WHERE id=?", [owner_user_id, this.lastID]);
      }
    }
  );
  res.redirect('/admin/packages');
});
router.get('/packages/:id/edit', isAdmin, (req, res) => {
  db.get("SELECT * FROM packages WHERE id=?", [req.params.id], (err, pkg) => {
    if (err || !pkg) return res.redirect('/admin/packages');
    db.all("SELECT id, name, email FROM users WHERE role='owner_package' AND email NOT IN ('partner@gmail.com', 'partner2@gmail.com') ORDER BY name ASC", (err2, owners) => {
      res.render('admin/package-edit', { title: 'Edit Package', pkg, owners: owners || [], user: req.session.user });
    });
  });
});
router.post('/packages/:id/edit', isAdmin, upload.single('image'), (req, res) => {
  const { name, destination, duration, price, includes, description, max_persons, current_image, owner_user_id } = req.body;
  const image = req.file ? `/uploads/${req.file.filename}` : current_image;
  db.run(
    "UPDATE packages SET name=?, destination=?, duration=?, price=?, includes=?, image=?, description=?, max_persons=?, owner_user_id=? WHERE id=?",
    [name, destination, duration, price, includes, image, description, max_persons || 20, owner_user_id || null, req.params.id]
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
