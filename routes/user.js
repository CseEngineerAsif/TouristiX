const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { isAuth } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../public/uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, `avatar-${Date.now()}${ext}`);
  }
});

const uploadAvatar = multer({
  storage: avatarStorage,
  fileFilter: (req, file, cb) => {
    const allowedExt = ['.jpg', '.jpeg', '.png', '.webp'];
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!allowedExt.includes(ext)) return cb(new Error('Only JPG, JPEG, PNG, and WEBP images are allowed.'));
    cb(null, true);
  },
  limits: { fileSize: 2 * 1024 * 1024 }
});

const reviewPhotoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../public/uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, `review-${Date.now()}${ext}`);
  }
});

const uploadReviewPhoto = multer({
  storage: reviewPhotoStorage,
  fileFilter: (req, file, cb) => {
    const allowedExt = ['.jpg', '.jpeg', '.png', '.webp'];
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!allowedExt.includes(ext)) return cb(new Error('Only JPG, JPEG, PNG, and WEBP images are allowed.'));
    cb(null, true);
  },
  limits: { fileSize: 3 * 1024 * 1024 }
});

function getTravelDateTime(travelDate, departureTime) {
  if (!travelDate || !departureTime) return null;

  const baseDate = new Date(`${travelDate}T00:00:00`);
  if (Number.isNaN(baseDate.getTime())) return null;

  const timeText = String(departureTime).trim();
  const match12 = timeText.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  const match24 = timeText.match(/^(\d{1,2}):(\d{2})$/);

  let hours = 0;
  let minutes = 0;

  if (match12) {
    hours = parseInt(match12[1], 10);
    minutes = parseInt(match12[2], 10);
    const meridiem = match12[3].toUpperCase();
    if (meridiem === 'PM' && hours < 12) hours += 12;
    if (meridiem === 'AM' && hours === 12) hours = 0;
  } else if (match24) {
    hours = parseInt(match24[1], 10);
    minutes = parseInt(match24[2], 10);
  } else {
    return null;
  }

  baseDate.setHours(hours, minutes, 0, 0);
  return baseDate;
}

function isExchangeOpen(travelDate, departureTime) {
  const departure = getTravelDateTime(travelDate, departureTime);
  if (!departure) return false;
  const diffMs = departure.getTime() - Date.now();
  const threeHoursMs = 3 * 60 * 60 * 1000;
  const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
  return diffMs > threeHoursMs && diffMs <= threeDaysMs;
}

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

function normalizePaymentMethod(method) {
  const value = String(method || '').trim().toLowerCase();
  if (value === 'bkash' || value === 'nagad') return value;
  return null;
}

function normalizePaymentNumber(number) {
  const value = String(number || '').trim().replace(/\s+/g, '');
  if (/^(?:\+?88)?01[3-9]\d{8}$/.test(value)) return value;
  return null;
}

function normalizePaymentTxnId(txnId) {
  const value = String(txnId || '').trim().toUpperCase();
  if (/^[A-Z0-9]{8,20}$/.test(value)) return value;
  return null;
}

function buildGatewayRef(method) {
  const prefix = method === 'bkash' ? 'BK' : 'NG';
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`;
}

// Home
router.get('/', (req, res) => {
  db.all("SELECT * FROM tourist_spots ORDER BY rating DESC LIMIT 6", (err, spots) => {
    db.all("SELECT * FROM packages LIMIT 3", (err2, packages) => {
      res.render('user/home', { title: 'Home', spots: spots || [], packages: packages || [], user: req.session.user });
    });
  });
});

// All Spots
router.get('/spots', (req, res) => {
  const { search, category, division } = req.query;
  let query = "SELECT * FROM tourist_spots WHERE 1=1";
  const params = [];
  if (search) { query += " AND (name LIKE ? OR district LIKE ?)"; params.push(`%${search}%`, `%${search}%`); }
  if (category) { query += " AND category = ?"; params.push(category); }
  if (division) { query += " AND division = ?"; params.push(division); }
  query += " ORDER BY rating DESC";
  db.all(query, params, (err, spots) => {
    res.render('user/spots', { title: 'Tourist Spots', spots: spots || [], search, category, division, user: req.session.user });
  });
});

// Spot Detail
router.get('/spots/:id', (req, res) => {
  db.get("SELECT * FROM tourist_spots WHERE id = ?", [req.params.id], (err, spot) => {
    if (!spot) return res.redirect('/spots');
    db.all("SELECT r.*, u.name as user_name FROM reviews r JOIN users u ON r.user_id=u.id WHERE r.spot_id=? ORDER BY r.created_at DESC", [spot.id], (err2, reviews) => {
      const renderDetail = (isFav) => {
        db.all(
          "SELECT * FROM hotels WHERE district = ? OR location LIKE ? ORDER BY rating DESC LIMIT 3",
          [spot.district, `%${spot.district}%`],
          (err3, hotels) => {
            db.all(
              "SELECT * FROM transport WHERE to_location LIKE ? OR to_location LIKE ? ORDER BY price ASC LIMIT 4",
              [`%${spot.district}%`, `%${spot.division}%`],
              (err4, transports) => {
                db.all(
                  `SELECT *,
                    (
                      CASE WHEN LOWER(specialty) LIKE LOWER(?) THEN 2 ELSE 0 END +
                      CASE WHEN LOWER(bio) LIKE LOWER(?) THEN 2 ELSE 0 END +
                      CASE WHEN LOWER(specialty) LIKE LOWER(?) THEN 1 ELSE 0 END +
                      CASE WHEN LOWER(bio) LIKE LOWER(?) THEN 1 ELSE 0 END
                    ) AS relevance
                   FROM guides
                   WHERE available = 1
                   ORDER BY relevance DESC, rating DESC
                   LIMIT 4`,
                  [`%${spot.category}%`, `%${spot.district}%`, `%${spot.division}%`, `%${spot.division}%`],
                  (err5, guides) => {
                    res.render('user/spot-detail', {
                      title: spot.name,
                      spot,
                      reviews: reviews || [],
                      isFav,
                      relatedHotels: hotels || [],
                      relatedTransports: transports || [],
                      relatedGuides: guides || [],
                      user: req.session.user
                    });
                  }
                );
              }
            );
          }
        );
      };

      if (req.session.user) {
        db.get("SELECT id FROM favorites WHERE user_id=? AND spot_id=?", [req.session.user.id, spot.id], (err3, fav) => {
          renderDetail(!!fav);
        });
      } else {
        renderDetail(false);
      }
    });
  });
});

// Hotels
router.get('/hotels', (req, res) => {
  const { district } = req.query;
  let query = "SELECT * FROM hotels WHERE 1=1";
  const params = [];
  if (district) { query += " AND district LIKE ?"; params.push(`%${district}%`); }
  db.all(query, params, (err, hotels) => {
    res.render('user/hotels', { title: 'Hotels', hotels: hotels || [], district, user: req.session.user });
  });
});

// Hotel Detail
router.get('/hotels/:id', (req, res) => {
  db.get("SELECT * FROM hotels WHERE id = ?", [req.params.id], (err, hotel) => {
    if (err || !hotel) return res.redirect('/hotels');
    db.all(
      "SELECT * FROM hotels WHERE district=? AND id!=? ORDER BY rating DESC LIMIT 3",
      [hotel.district, hotel.id],
      (err2, relatedHotels) => {
        const facilities = (hotel.facilities || '')
          .split(',')
          .map(f => f.trim())
          .filter(Boolean);
        res.render('user/hotel-detail', {
          title: hotel.name,
          hotel,
          facilities,
          relatedHotels: relatedHotels || [],
          user: req.session.user
        });
      }
    );
  });
});

// Transport
router.get('/transport', (req, res) => {
  const { from, to, type } = req.query;
  let query = "SELECT * FROM transport WHERE 1=1";
  const params = [];
  if (from) { query += " AND from_location LIKE ?"; params.push(`%${from}%`); }
  if (to) { query += " AND to_location LIKE ?"; params.push(`%${to}%`); }
  if (type) { query += " AND type = ?"; params.push(type); }
  db.all(query, params, (err, transports) => {
    if (!req.session.user) {
      return res.render('user/transport', {
        title: 'Transport',
        transports: transports || [],
        from,
        to,
        type,
        myTransportTickets: [],
        releasedTickets: [],
        user: req.session.user
      });
    }

    const uid = req.session.user.id;
    db.get("SELECT wallet_balance FROM users WHERE id=?", [uid], (walletErr, me) => {
      db.all(
        `SELECT b.*, t.type as transport_type, t.from_location, t.to_location, t.departure_time
         FROM bookings b
         JOIN transport t ON t.id = b.item_id
         WHERE b.user_id = ? AND b.type='transport' AND b.status IN ('pending','confirmed','released')
         ORDER BY CASE WHEN b.status='released' THEN 0 ELSE 1 END, b.check_in ASC`,
        [uid],
        (err2, myTickets) => {
          db.all(
            `SELECT b.*, u.name as releaser_name, t.type as transport_type, t.from_location, t.to_location, t.departure_time,
                    EXISTS(
                      SELECT 1 FROM exchange_requests er
                      WHERE er.booking_id = b.id AND er.requester_id = ? AND er.status = 'pending'
                    ) as already_requested
             FROM bookings b
             JOIN users u ON u.id = b.user_id
             JOIN transport t ON t.id = b.item_id
             WHERE b.type='transport' AND b.status='released' AND b.user_id != ?
             ORDER BY b.check_in ASC, b.created_at DESC`,
            [uid, uid],
            (err3, releasedTickets) => {
              db.all(
                `SELECT er.*, b.item_name, b.check_in, b.total_price, t.from_location, t.to_location, t.departure_time,
                        u.name as requester_name
                 FROM exchange_requests er
                 JOIN bookings b ON b.id = er.booking_id
                 JOIN transport t ON t.id = b.item_id
                 JOIN users u ON u.id = er.requester_id
                 WHERE b.user_id = ? AND b.type='transport' AND b.status='released' AND er.status='pending'
                 ORDER BY er.created_at ASC`,
                [uid],
                (err4, incomingExchangeRequests) => {
                  db.all(
                    `SELECT er.*, b.item_name, b.check_in, t.from_location, t.to_location, t.departure_time,
                            u.name as owner_name
                     FROM exchange_requests er
                     JOIN bookings b ON b.id = er.booking_id
                     JOIN transport t ON t.id = b.item_id
                     JOIN users u ON u.id = b.user_id
                     WHERE er.requester_id = ? AND b.type='transport'
                     ORDER BY er.created_at DESC`,
                    [uid],
                    (err5, myExchangeRequests) => {
                      const mappedMyTickets = (myTickets || []).map((ticket) => ({
                        ...ticket,
                        exchange_open: isExchangeOpen(ticket.check_in, ticket.departure_time)
                      }));
                      const mappedReleasedTickets = (releasedTickets || []).map((ticket) => ({
                        ...ticket,
                        exchange_open: isExchangeOpen(ticket.check_in, ticket.departure_time)
                      }));

                      res.render('user/transport', {
                        title: 'Transport',
                        transports: transports || [],
                        from,
                        to,
                        type,
                        myTransportTickets: mappedMyTickets,
                        releasedTickets: mappedReleasedTickets,
                        incomingExchangeRequests: incomingExchangeRequests || [],
                        myExchangeRequests: myExchangeRequests || [],
                        walletBalance: (me && me.wallet_balance) || 0,
                        user: req.session.user
                      });
                    }
                  );
                }
              );
            }
          );
        }
      );
    });
  });
});

// Guides
router.get('/guides', (req, res) => {
  db.all("SELECT * FROM guides WHERE available=1 ORDER BY rating DESC", (err, guides) => {
    res.render('user/guides', { title: 'Guides', guides: guides || [], user: req.session.user });
  });
});

router.get('/guides/:id', (req, res) => {
  db.get("SELECT * FROM guides WHERE id = ?", [req.params.id], (err, guide) => {
    if (err || !guide) return res.redirect('/guides');
    db.all(
      "SELECT * FROM guides WHERE available=1 AND id != ? ORDER BY rating DESC LIMIT 4",
      [guide.id],
      (err2, relatedGuides) => {
        res.render('user/guide-profile', {
          title: guide.name,
          guide,
          relatedGuides: relatedGuides || [],
          user: req.session.user
        });
      }
    );
  });
});

router.get('/guides/:id/chat', isAuth, (req, res) => {
  const guideId = parseInt(req.params.id, 10);
  if (!Number.isInteger(guideId) || guideId <= 0) return res.redirect('/guides');

  db.get("SELECT * FROM guides WHERE id=? AND available=1", [guideId], (err, guide) => {
    if (err || !guide) {
      req.flash('error', 'Guide not found.');
      return res.redirect('/guides');
    }
    db.all(
      `SELECT gm.*, u.name as user_name, g.name as guide_name
       FROM guide_messages gm
       JOIN users u ON u.id = gm.user_id
       JOIN guides g ON g.id = gm.guide_id
       WHERE gm.user_id=? AND gm.guide_id=?
       ORDER BY gm.created_at ASC, gm.id ASC`,
      [req.session.user.id, guideId],
      (err2, messages) => {
        res.render('user/guide-chat', {
          title: `Chat with ${guide.name}`,
          guide,
          messages: messages || [],
          user: req.session.user
        });
      }
    );
  });
});

router.post('/guides/:id/chat', isAuth, (req, res) => {
  const guideId = parseInt(req.params.id, 10);
  const text = String(req.body.message || '').trim();
  if (!Number.isInteger(guideId) || guideId <= 0) return res.redirect('/guides');
  if (!text) {
    req.flash('error', 'Please write a message.');
    return res.redirect(`/guides/${guideId}/chat`);
  }

  db.get("SELECT id, name FROM guides WHERE id=? AND available=1", [guideId], (err, guide) => {
    if (err || !guide) {
      req.flash('error', 'Guide not found.');
      return res.redirect('/guides');
    }

    const uid = req.session.user.id;
    db.run(
      "INSERT INTO guide_messages (user_id, guide_id, sender_role, message) VALUES (?,?,?,?)",
      [uid, guideId, 'user', text],
      function (insertErr) {
        if (insertErr) {
          req.flash('error', 'Could not send message. Please try again.');
          return res.redirect(`/guides/${guideId}/chat`);
        }

        const autoReply = `Thanks for your message. I am ${guide.name}. I will get back to you soon.`;
        db.run(
          "INSERT INTO guide_messages (user_id, guide_id, sender_role, message) VALUES (?,?,?,?)",
          [uid, guideId, 'guide', autoReply],
          () => res.redirect(`/guides/${guideId}/chat`)
        );
      }
    );
  });
});

// Packages
router.get('/packages', (req, res) => {
  db.all("SELECT * FROM packages ORDER BY id DESC", (err, packages) => {
    res.render('user/packages', { title: 'Travel Packages', packages: packages || [], user: req.session.user });
  });
});

router.get('/packages/:id', (req, res) => {
  db.get("SELECT * FROM packages WHERE id = ?", [req.params.id], (err, pkg) => {
    if (err || !pkg) return res.redirect('/packages');
    db.all(
      "SELECT * FROM packages WHERE id != ? ORDER BY id DESC LIMIT 3",
      [pkg.id],
      (err2, relatedPackages) => {
        res.render('user/package-detail', {
          title: pkg.name,
          pkg,
          relatedPackages: relatedPackages || [],
          user: req.session.user
        });
      }
    );
  });
});

// Dashboard
router.get('/dashboard', isAuth, (req, res) => {
  const uid = req.session.user.id;
  db.get("SELECT id, name, email, phone, address, id_type, id_document, avatar, created_at FROM users WHERE id=?", [uid], (err0, profile) => {
    db.all("SELECT * FROM bookings WHERE user_id=? ORDER BY created_at DESC", [uid], (err, bookings) => {
      db.all("SELECT f.*, s.name, s.image, s.district FROM favorites f JOIN tourist_spots s ON f.spot_id=s.id WHERE f.user_id=?", [uid], (err2, favs) => {
        res.render('user/dashboard', {
          title: 'My Dashboard',
          profile: profile || null,
          bookings: bookings || [],
          favorites: favs || [],
          user: req.session.user
        });
      });
    });
  });
});

router.post('/dashboard/profile/photo', isAuth, uploadAvatar.single('avatar'), (req, res) => {
  const uid = req.session.user.id;
  if (!req.file) {
    req.flash('error', 'Please select a photo first.');
    return res.redirect('/dashboard');
  }

  const avatarPath = `/uploads/${req.file.filename}`;
  db.run("UPDATE users SET avatar=? WHERE id=?", [avatarPath, uid], function (err) {
    if (err || this.changes === 0) {
      req.flash('error', 'Could not update profile photo.');
      return res.redirect('/dashboard');
    }
    if (req.session.user) req.session.user.avatar = avatarPath;
    req.flash('success', 'Profile photo updated successfully.');
    return res.redirect('/dashboard');
  });
});

// Book Hotel
router.post('/book/hotel', isAuth, (req, res) => {
  const {
    hotel_id, hotel_name, check_in, check_out, persons, total_price,
    payment_method, payment_number, payment_txn_id
  } = req.body;
  const method = normalizePaymentMethod(payment_method);
  const payerNumber = normalizePaymentNumber(payment_number);
  const txnId = normalizePaymentTxnId(payment_txn_id);
  if (!method) {
    req.flash('error', 'Please choose a valid payment method (bKash or Nagad).');
    return res.redirect('/hotels');
  }
  if (!payerNumber || !txnId) {
    req.flash('error', 'Please provide a valid payment number and transaction ID.');
    return res.redirect('/hotels');
  }
  const gatewayRef = buildGatewayRef(method);
  db.run("INSERT INTO bookings (user_id, type, item_id, item_name, check_in, check_out, persons, total_price, payment_method, payment_status, payment_number, payment_txn_id, payment_gateway_ref, paid_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)",
    [req.session.user.id, 'hotel', hotel_id, hotel_name, check_in, check_out, persons, total_price, method, 'paid', payerNumber, txnId, gatewayRef], (err) => {
    req.flash('success', 'Hotel booked successfully!');
    res.redirect('/dashboard');
  });
});

// Book Transport
router.post('/book/transport', isAuth, (req, res) => {
  const {
    transport_id, transport_name, travel_date, persons, total_price,
    payment_method, payment_number, payment_txn_id
  } = req.body;
  const transportId = parseInt(transport_id, 10);
  const personsCount = parseInt(persons, 10);
  const method = normalizePaymentMethod(payment_method);
  const payerNumber = normalizePaymentNumber(payment_number);
  const txnId = normalizePaymentTxnId(payment_txn_id);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(String(travel_date || ''));
  const isValidPersons = Number.isInteger(personsCount) && personsCount >= 1 && personsCount <= 10;

  if (!Number.isInteger(transportId) || transportId <= 0) {
    req.flash('error', 'Invalid transport option selected.');
    return res.redirect('/transport');
  }
  if (!validDate) {
    req.flash('error', 'Please choose a valid travel date.');
    return res.redirect('/transport');
  }
  if (!isValidPersons) {
    req.flash('error', 'Please choose between 1 and 10 tickets.');
    return res.redirect('/transport');
  }
  const todayStr = new Date().toISOString().split('T')[0];
  if (travel_date < todayStr) {
    req.flash('error', 'Travel date cannot be in the past.');
    return res.redirect('/transport');
  }
  if (!method) {
    req.flash('error', 'Please choose a valid payment method (bKash or Nagad).');
    return res.redirect('/transport');
  }
  if (!payerNumber || !txnId) {
    req.flash('error', 'Please provide a valid payment number and transaction ID.');
    return res.redirect('/transport');
  }

  db.get(
    "SELECT id, type, company, from_location, to_location, departure_time, price, seats_available FROM transport WHERE id=?",
    [transportId],
    (err, transport) => {
      if (err || !transport) {
        req.flash('error', 'Selected transport was not found.');
        return res.redirect('/transport');
      }
      if ((transport.seats_available || 0) < personsCount) {
        req.flash('error', `Only ${transport.seats_available || 0} ticket(s) are available for this transport.`);
        return res.redirect('/transport');
      }

      const gatewayRef = buildGatewayRef(method);
      const calculatedTotal = Number(transport.price || 0) * personsCount;
      const safeTransportName =
        `${transport.company || transport_name || transport.type} - ${transport.from_location} to ${transport.to_location}`;

      db.run(
        "INSERT INTO bookings (user_id, type, item_id, item_name, check_in, persons, total_price, payment_method, payment_status, payment_number, payment_txn_id, payment_gateway_ref, paid_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)",
        [req.session.user.id, 'transport', transport.id, safeTransportName, travel_date, personsCount, calculatedTotal, method, 'paid', payerNumber, txnId, gatewayRef],
        function (insertErr) {
          if (insertErr) {
            req.flash('error', 'Could not complete transport booking. Please try again.');
            return res.redirect('/transport');
          }
          req.flash('success', 'Transport booked successfully!');
          return res.redirect('/dashboard');
        }
      );
    }
  );
});

// Release transport ticket for exchange (window: within 3 days and before 3 hours of departure)
router.post('/bookings/:id/release-ticket', isAuth, (req, res) => {
  const bookingId = req.params.id;
  const uid = req.session.user.id;

  db.get(
    `SELECT b.*, t.departure_time
     FROM bookings b
     JOIN transport t ON t.id = b.item_id
     WHERE b.id = ? AND b.user_id = ? AND b.type = 'transport'`,
    [bookingId, uid],
    (err, booking) => {
      if (err || !booking) {
        req.flash('error', 'Transport booking not found.');
        return res.redirect('/transport');
      }
      if (booking.status !== 'confirmed') {
        req.flash('error', 'Only admin-confirmed transport tickets can be released.');
        return res.redirect('/transport');
      }
      if (booking.exchange_locked) {
        req.flash('error', 'This exchanged ticket is locked and cannot be released.');
        return res.redirect('/transport');
      }
      if (!isExchangeOpen(booking.check_in, booking.departure_time)) {
        req.flash('error', 'Ticket can only be released within 3 days and before 3 hours of departure.');
        return res.redirect('/transport');
      }

      const note = `\nReleased for exchange at ${new Date().toISOString()}.`;
      db.run(
        "UPDATE bookings SET status='released', notes=COALESCE(notes,'') || ? WHERE id=? AND user_id=? AND status='confirmed'",
        [note, bookingId, uid],
        function (updateErr) {
          if (updateErr || this.changes === 0) {
            req.flash('error', 'Could not release ticket. Please try again.');
            return res.redirect('/transport');
          }
          req.flash('success', 'Ticket released. Other tourists can now claim it.');
          return res.redirect('/transport');
        }
      );
    }
  );
});

// Request a released transport ticket and hold requester payment
router.post('/tickets/:id/request-exchange', isAuth, (req, res) => {
  const bookingId = req.params.id;
  const uid = req.session.user.id;

  db.get(
    `SELECT b.*, t.departure_time
     FROM bookings b
     JOIN transport t ON t.id = b.item_id
     WHERE b.id = ? AND b.type = 'transport' AND b.status = 'released'`,
    [bookingId],
    (err, booking) => {
      if (err || !booking) {
        req.flash('error', 'Released ticket not found.');
        return res.redirect('/transport');
      }
      if (booking.user_id === uid) {
        req.flash('error', 'You cannot request your own released ticket.');
        return res.redirect('/transport');
      }
      if (!isExchangeOpen(booking.check_in, booking.departure_time)) {
        req.flash('error', 'This ticket can only be requested within 3 days and before 3 hours of departure.');
        return res.redirect('/transport');
      }

      db.get(
        `SELECT id
         FROM exchange_requests
         WHERE booking_id = ? AND requester_id = ? AND status IN ('pending','accepted')
         ORDER BY created_at DESC
         LIMIT 1`,
        [bookingId, uid],
        (checkErr, existingReq) => {
          if (checkErr) {
            req.flash('error', 'Could not submit request now. Please try again.');
            return res.redirect('/transport');
          }
          if (existingReq) {
            req.flash('error', 'You already requested this exchanged ticket.');
            return res.redirect('/transport');
          }

          const amount = Number(booking.total_price || 0);
          withTransaction((finish) => {
            db.get("SELECT wallet_balance FROM users WHERE id=?", [uid], (walletErr, requester) => {
              if (walletErr || !requester) {
                return finish(new Error('Requester account not found.'));
              }
              if ((requester.wallet_balance || 0) < amount) {
                return finish(new Error('INSUFFICIENT_BALANCE'));
              }
              db.run(
                "UPDATE users SET wallet_balance = wallet_balance - ? WHERE id=?",
                [amount, uid],
                function (debitErr) {
                  if (debitErr || this.changes === 0) return finish(debitErr || new Error('Could not hold payment.'));
                  db.run(
                    "INSERT INTO exchange_requests (booking_id, requester_id, amount, payment_status, status) VALUES (?, ?, ?, 'held', 'pending')",
                    [bookingId, uid, amount],
                    function (insertErr) {
                      if (insertErr) return finish(insertErr);
                      return finish(null);
                    }
                  );
                }
              );
            });
          }, (txErr) => {
            if (txErr) {
              if (txErr.message === 'INSUFFICIENT_BALANCE') {
                req.flash('error', 'Not enough wallet balance to request this ticket.');
              } else {
                req.flash('error', 'Could not submit request now. Please try again.');
              }
              return res.redirect('/transport');
            }
            req.flash('success', 'Exchange request submitted. Payment is held until owner approval.');
            return res.redirect('/transport');
          });
        }
      );
    }
  );
});

// Owner accepts a pending exchange request and receives payment
router.post('/exchange-requests/:id/accept', isAuth, (req, res) => {
  const requestId = req.params.id;
  const ownerId = req.session.user.id;

  withTransaction((finish) => {
    db.get(
      `SELECT er.*, b.user_id as owner_id, b.check_in, b.item_name, b.status as booking_status,
              t.departure_time
       FROM exchange_requests er
       JOIN bookings b ON b.id = er.booking_id
       JOIN transport t ON t.id = b.item_id
       WHERE er.id=? AND er.status='pending'`,
      [requestId],
      (err, exchangeReq) => {
        if (err || !exchangeReq) return finish(new Error('REQUEST_NOT_FOUND'));
        if (exchangeReq.owner_id !== ownerId) return finish(new Error('NOT_OWNER'));
        if (exchangeReq.booking_status !== 'released') return finish(new Error('BOOKING_NOT_RELEASED'));
        if (!isExchangeOpen(exchangeReq.check_in, exchangeReq.departure_time)) return finish(new Error('WINDOW_CLOSED'));

        const amount = Number(exchangeReq.amount || 0);
        const note = `\nExchange accepted by owner #${ownerId} at ${new Date().toISOString()}.`;

        const proceedBookingTransfer = () => {
          db.run(
            "UPDATE bookings SET user_id=?, status='confirmed', exchange_locked=1, notes=COALESCE(notes,'') || ? WHERE id=? AND status='released'",
            [exchangeReq.requester_id, note, exchangeReq.booking_id],
            function (transferErr) {
              if (transferErr || this.changes === 0) return finish(transferErr || new Error('TRANSFER_FAILED'));
              db.run(
                "UPDATE exchange_requests SET status='accepted', payment_status='released_to_owner', processed_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'",
                [requestId],
                function (acceptErr) {
                  if (acceptErr || this.changes === 0) return finish(acceptErr || new Error('ACCEPT_FAILED'));
                  db.all(
                    "SELECT id, requester_id, amount FROM exchange_requests WHERE booking_id=? AND status='pending' AND id!=?",
                    [exchangeReq.booking_id, requestId],
                    (othersErr, others) => {
                      if (othersErr) return finish(othersErr);
                      let idx = 0;
                      const processNext = () => {
                        if (idx >= (others || []).length) return finish(null);
                        const other = others[idx++];
                        const refundAmount = Number(other.amount || 0);
                        const finalizeReject = () => {
                          db.run(
                            "UPDATE exchange_requests SET status='rejected', payment_status='refunded', admin_note='Another requester accepted by owner.', processed_at=CURRENT_TIMESTAMP WHERE id=?",
                            [other.id],
                            (rejectErr) => {
                              if (rejectErr) return finish(rejectErr);
                              return processNext();
                            }
                          );
                        };
                        if (refundAmount <= 0) return finalizeReject();
                        db.run(
                          "UPDATE users SET wallet_balance = wallet_balance + ? WHERE id=?",
                          [refundAmount, other.requester_id],
                          function (refundErr) {
                            if (refundErr || this.changes === 0) return finish(refundErr || new Error('REFUND_FAILED'));
                            return finalizeReject();
                          }
                        );
                      };
                      return processNext();
                    }
                  );
                }
              );
            }
          );
        };

        if (amount <= 0) return proceedBookingTransfer();
        db.run(
          "UPDATE users SET wallet_balance = wallet_balance + ? WHERE id=?",
          [amount, ownerId],
          function (creditErr) {
            if (creditErr || this.changes === 0) return finish(creditErr || new Error('CREDIT_FAILED'));
            return proceedBookingTransfer();
          }
        );
      }
    );
  }, (txErr) => {
    if (txErr) {
      req.flash('error', 'Could not accept exchange request.');
      return res.redirect('/transport');
    }
    req.flash('success', 'Exchange accepted. Ticket transferred and payment sent to your wallet.');
    return res.redirect('/transport');
  });
});

// Owner rejects a pending exchange request and requester gets refund
router.post('/exchange-requests/:id/reject', isAuth, (req, res) => {
  const requestId = req.params.id;
  const ownerId = req.session.user.id;

  withTransaction((finish) => {
    db.get(
      `SELECT er.*, b.user_id as owner_id
       FROM exchange_requests er
       JOIN bookings b ON b.id = er.booking_id
       WHERE er.id=? AND er.status='pending'`,
      [requestId],
      (err, exchangeReq) => {
        if (err || !exchangeReq) return finish(new Error('REQUEST_NOT_FOUND'));
        if (exchangeReq.owner_id !== ownerId) return finish(new Error('NOT_OWNER'));

        const refundAmount = Number(exchangeReq.amount || 0);
        const finalizeReject = () => {
          db.run(
            "UPDATE exchange_requests SET status='rejected', payment_status='refunded', admin_note='Rejected by ticket owner.', processed_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'",
            [requestId],
            function (updateErr) {
              if (updateErr || this.changes === 0) return finish(updateErr || new Error('REJECT_FAILED'));
              return finish(null);
            }
          );
        };

        if (refundAmount <= 0) return finalizeReject();
        db.run(
          "UPDATE users SET wallet_balance = wallet_balance + ? WHERE id=?",
          [refundAmount, exchangeReq.requester_id],
          function (refundErr) {
            if (refundErr || this.changes === 0) return finish(refundErr || new Error('REFUND_FAILED'));
            return finalizeReject();
          }
        );
      }
    );
  }, (txErr) => {
    if (txErr) {
      req.flash('error', 'Could not reject exchange request.');
      return res.redirect('/transport');
    }
    req.flash('success', 'Exchange request rejected and payment refunded.');
    return res.redirect('/transport');
  });
});

// Book Guide
router.post('/book/guide', isAuth, (req, res) => {
  const {
    guide_id, guide_name, start_date, days, total_price,
    payment_method, payment_number, payment_txn_id
  } = req.body;
  const method = normalizePaymentMethod(payment_method);
  const payerNumber = normalizePaymentNumber(payment_number);
  const txnId = normalizePaymentTxnId(payment_txn_id);
  if (!method) {
    req.flash('error', 'Please choose a valid payment method (bKash or Nagad).');
    return res.redirect('/guides');
  }
  if (!payerNumber || !txnId) {
    req.flash('error', 'Please provide a valid payment number and transaction ID.');
    return res.redirect('/guides');
  }
  const gatewayRef = buildGatewayRef(method);
  db.run("INSERT INTO bookings (user_id, type, item_id, item_name, check_in, persons, total_price, payment_method, payment_status, payment_number, payment_txn_id, payment_gateway_ref, paid_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)",
    [req.session.user.id, 'guide', guide_id, guide_name, start_date, days, total_price, method, 'paid', payerNumber, txnId, gatewayRef], (err) => {
    req.flash('success', 'Guide hired successfully!');
    res.redirect('/dashboard');
  });
});

// Book Package
router.post('/book/package', isAuth, (req, res) => {
  const {
    pkg_id, pkg_name, travel_date, persons, total_price,
    payment_method, payment_number, payment_txn_id
  } = req.body;
  const method = normalizePaymentMethod(payment_method);
  const payerNumber = normalizePaymentNumber(payment_number);
  const txnId = normalizePaymentTxnId(payment_txn_id);
  if (!method) {
    req.flash('error', 'Please choose a valid payment method (bKash or Nagad).');
    return res.redirect('/packages');
  }
  if (!payerNumber || !txnId) {
    req.flash('error', 'Please provide a valid payment number and transaction ID.');
    return res.redirect('/packages');
  }
  const gatewayRef = buildGatewayRef(method);
  db.run("INSERT INTO bookings (user_id, type, item_id, item_name, check_in, persons, total_price, payment_method, payment_status, payment_number, payment_txn_id, payment_gateway_ref, paid_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)",
    [req.session.user.id, 'package', pkg_id, pkg_name, travel_date, persons, total_price, method, 'paid', payerNumber, txnId, gatewayRef], (err) => {
    req.flash('success', 'Package booked!');
    res.redirect('/dashboard');
  });
});

// Add Review
router.post('/spots/:id/review', isAuth, uploadReviewPhoto.single('photo'), (req, res) => {
  const { rating, comment } = req.body;
  const spotId = req.params.id;
  const photo = req.file ? `/uploads/${req.file.filename}` : '';
  db.run("INSERT INTO reviews (user_id, spot_id, rating, comment, photo) VALUES (?,?,?,?,?)",
    [req.session.user.id, spotId, rating, comment, photo], () => {
    db.get("SELECT AVG(rating) as avg, COUNT(*) as cnt FROM reviews WHERE spot_id=?", [spotId], (err, r) => {
      db.run("UPDATE tourist_spots SET rating=?, total_reviews=? WHERE id=?", [r.avg.toFixed(1), r.cnt, spotId]);
    });
    res.redirect('/spots/' + spotId);
  });
});

// Toggle Favorite
router.post('/spots/:id/favorite', isAuth, (req, res) => {
  const { id } = req.params;
  const uid = req.session.user.id;
  db.get("SELECT id FROM favorites WHERE user_id=? AND spot_id=?", [uid, id], (err, fav) => {
    if (fav) {
      db.run("DELETE FROM favorites WHERE user_id=? AND spot_id=?", [uid, id]);
    } else {
      db.run("INSERT INTO favorites (user_id, spot_id) VALUES (?,?)", [uid, id]);
    }
    res.redirect('/spots/' + id);
  });
});

// Cancel Booking
router.post('/bookings/:id/cancel', isAuth, (req, res) => {
  db.get("SELECT id, status, exchange_locked FROM bookings WHERE id=? AND user_id=?", [req.params.id, req.session.user.id], (err, booking) => {
    if (err || !booking) {
      req.flash('error', 'Booking not found.');
      return res.redirect('/dashboard');
    }
    if (booking.exchange_locked) {
      req.flash('error', 'This exchanged ticket cannot be cancelled by user.');
      return res.redirect('/dashboard');
    }
    db.run("UPDATE bookings SET status='cancelled' WHERE id=? AND user_id=?", [req.params.id, req.session.user.id], () => {
      req.flash('success', 'Booking cancelled successfully.');
      return res.redirect('/dashboard');
    });
  });
});

router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err) {
    req.flash('error', err.message || 'File upload failed.');
    return res.redirect(req.get('referer') || '/dashboard');
  }
  next(err);
});

module.exports = router;
