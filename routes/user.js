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

const blogMediaStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../public/uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, `blog-${Date.now()}-${Math.floor(Math.random() * 10000)}${ext}`);
  }
});

const uploadBlogMedia = multer({
  storage: blogMediaStorage,
  fileFilter: (req, file, cb) => {
    const allowedExt = ['.jpg', '.jpeg', '.png', '.webp', '.mp4', '.webm', '.mov'];
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!allowedExt.includes(ext)) return cb(new Error('Only images (JPG, PNG, WEBP) and videos (MP4, WEBM, MOV) are allowed.'));
    cb(null, true);
  },
  limits: { fileSize: 15 * 1024 * 1024 }
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

const USER_FEE_RATE = 0.01;
const COMMISSION_RATES = {
  hotel: 0.10,
  transport: 0.10,
  guide: 0.03,
  package: 0
};

function calcUserFee(amount) {
  const fee = Math.ceil(Number(amount || 0) * USER_FEE_RATE);
  return Number.isFinite(fee) ? fee : 0;
}

function commissionRateFor(type) {
  return COMMISSION_RATES[type] ?? 0;
}

function recordWalletTx(userId, amount, type, refType, refId, note, cb) {
  db.run(
    "INSERT INTO wallet_transactions (user_id, amount, type, ref_type, ref_id, note) VALUES (?,?,?,?,?,?)",
    [userId, amount, type, refType || null, refId || null, note || ''],
    cb || (() => {})
  );
}

function getAdminUserId(cb) {
  db.get("SELECT id FROM users WHERE role='admin' ORDER BY id ASC LIMIT 1", (err, row) => {
    if (err || !row) return cb(null);
    return cb(row.id);
  });
}

function getProviderUserId(type, itemId, cb) {
  if (type === 'hotel') {
    return db.get("SELECT owner_user_id FROM hotels WHERE id=?", [itemId], (err, row) => cb(err, row?.owner_user_id || null));
  }
  if (type === 'transport') {
    return db.get("SELECT owner_user_id FROM transport WHERE id=?", [itemId], (err, row) => cb(err, row?.owner_user_id || null));
  }
  if (type === 'guide') {
    return db.get("SELECT owner_user_id FROM guides WHERE id=?", [itemId], (err, row) => cb(err, row?.owner_user_id || null));
  }
  if (type === 'package') {
    return db.get("SELECT owner_user_id FROM packages WHERE id=?", [itemId], (err, row) => {
      if (err) return cb(err);
      if (row && row.owner_user_id) return cb(null, row.owner_user_id);
      return getAdminUserId((adminId) => cb(null, adminId));
    });
  }
  return cb(null, null);
}

function safeReturnTo(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (!raw.startsWith('/')) return '';
  if (raw.startsWith('//')) return '';
  if (raw.includes('://')) return '';
  return raw;
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
  const returnTo = safeReturnTo(req.query.return);
  let query = "SELECT * FROM hotels WHERE 1=1";
  const params = [];
  if (district) { query += " AND district LIKE ?"; params.push(`%${district}%`); }
  db.all(query, params, (err, hotels) => {
    res.render('user/hotels', {
      title: 'Hotels',
      hotels: hotels || [],
      district,
      returnTo,
      user: req.session.user
    });
  });
});

// Hotel Detail
router.get('/hotels/:id', (req, res) => {
  const returnTo = safeReturnTo(req.query.return);
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
          returnTo,
          user: req.session.user
        });
      }
    );
  });
});

// Hotel Chat
router.get('/hotels/:id/chat', isAuth, (req, res) => {
  const hotelId = parseInt(req.params.id, 10);
  if (!Number.isInteger(hotelId) || hotelId <= 0) return res.redirect('/hotels');

  db.get("SELECT * FROM hotels WHERE id=?", [hotelId], (err, hotel) => {
    if (err || !hotel) {
      req.flash('error', 'Hotel not found.');
      return res.redirect('/hotels');
    }
    db.all(
      `SELECT hm.*, u.name as user_name, h.name as hotel_name
       FROM hotel_messages hm
       JOIN users u ON u.id = hm.user_id
       JOIN hotels h ON h.id = hm.hotel_id
       WHERE hm.user_id=? AND hm.hotel_id=?
       ORDER BY hm.created_at ASC, hm.id ASC`,
      [req.session.user.id, hotelId],
      (err2, messages) => {
        res.render('user/hotel-chat', {
          title: `Chat with ${hotel.name}`,
          hotel,
          messages: messages || [],
          returnTo: safeReturnTo(req.query.return),
          user: req.session.user
        });
      }
    );
  });
});

router.post('/hotels/:id/chat', isAuth, (req, res) => {
  const hotelId = parseInt(req.params.id, 10);
  const text = String(req.body.message || '').trim();
  const returnTo = safeReturnTo(req.query.return);
  const backUrl = returnTo ? `/hotels/${hotelId}/chat?return=${encodeURIComponent(returnTo)}` : `/hotels/${hotelId}/chat`;
  if (!Number.isInteger(hotelId) || hotelId <= 0) return res.redirect('/hotels');
  if (!text) {
    req.flash('error', 'Please write a message.');
    return res.redirect(backUrl);
  }

  db.get("SELECT id, name FROM hotels WHERE id=?", [hotelId], (err, hotel) => {
    if (err || !hotel) {
      req.flash('error', 'Hotel not found.');
      return res.redirect('/hotels');
    }

    const uid = req.session.user.id;
    db.run(
      "INSERT INTO hotel_messages (user_id, hotel_id, sender_role, message) VALUES (?,?,?,?)",
      [uid, hotelId, 'user', text],
      function (insertErr) {
        if (insertErr) {
          req.flash('error', 'Could not send message. Please try again.');
          return res.redirect(backUrl);
        }

        const autoReply = `Thanks for your message. Our team at ${hotel.name} will respond soon.`;
        db.run(
          "INSERT INTO hotel_messages (user_id, hotel_id, sender_role, message) VALUES (?,?,?,?)",
          [uid, hotelId, 'hotel', autoReply],
          () => res.redirect(backUrl)
        );
      }
    );
  });
});

// Transport
router.get('/transport', (req, res) => {
  const { from, to, type } = req.query;
  const returnTo = safeReturnTo(req.query.return);
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
        returnTo,
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
                        returnTo,
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
          returnTo: safeReturnTo(req.query.return),
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

// Blog
router.get('/blog', (req, res) => {
  db.all(
    `SELECT bp.*, u.name as author_name, u.avatar as author_avatar
     FROM blog_posts bp
     JOIN users u ON u.id = bp.user_id
     ORDER BY bp.created_at DESC`,
    (err, posts) => {
      res.render('user/blog', {
        title: 'Blog',
        posts: posts || [],
        user: req.session.user
      });
    }
  );
});

router.post('/blog', isAuth, uploadBlogMedia.array('media', 10), (req, res) => {
  const title = String(req.body.title || '').trim();
  const content = String(req.body.content || '').trim();
  if (!title || !content) {
    req.flash('error', 'Please provide a title and your travel story.');
    return res.redirect('/blog');
  }
  const media = (req.files || []).map(f => `/uploads/${f.filename}`);
  const mediaText = media.join(',');

  db.run(
    "INSERT INTO blog_posts (user_id, title, content, media_urls) VALUES (?,?,?,?)",
    [req.session.user.id, title, content, mediaText],
    (err) => {
      if (err) {
        req.flash('error', 'Could not publish blog post. Please try again.');
        return res.redirect('/blog');
      }
      req.flash('success', 'Blog post published successfully!');
      return res.redirect('/blog');
    }
  );
});

// Dashboard
router.get('/dashboard', isAuth, (req, res) => {
  const uid = req.session.user.id;
  db.get("SELECT id, name, email, phone, address, id_type, id_document, avatar, created_at, wallet_balance FROM users WHERE id=?", [uid], (err0, profile) => {
    db.all("SELECT * FROM bookings WHERE user_id=? ORDER BY created_at DESC", [uid], (err, bookings) => {
      db.all("SELECT f.*, s.name, s.image, s.district FROM favorites f JOIN tourist_spots s ON f.spot_id=s.id WHERE f.user_id=?", [uid], (err2, favs) => {
        db.all("SELECT * FROM wallet_transactions WHERE user_id=? ORDER BY created_at DESC LIMIT 10", [uid], (err3, walletTx) => {
          res.render('user/dashboard', {
            title: 'My Dashboard',
            profile: profile || null,
            bookings: bookings || [],
            favorites: favs || [],
            walletBalance: (profile && profile.wallet_balance) || 0,
            walletTx: walletTx || [],
            user: req.session.user
          });
        });
      });
    });
  });
});

// Wallet top-up
router.post('/wallet/topup', isAuth, (req, res) => {
  const uid = req.session.user.id;
  const amount = parseInt(req.body.amount, 10);
  const gateway = normalizePaymentMethod(req.body.gateway);

  if (!gateway) {
    req.flash('error', 'Please select bKash or Nagad for top-up.');
    return res.redirect('/dashboard');
  }
  if (!Number.isInteger(amount) || amount <= 0) {
    req.flash('error', 'Please enter a valid top-up amount.');
    return res.redirect('/dashboard');
  }

  const gatewayRef = buildGatewayRef(gateway);
  db.run(
    "INSERT INTO wallet_topups (user_id, gateway, amount, status, gateway_ref) VALUES (?,?,?,?,?)",
    [uid, gateway, amount, 'pending', gatewayRef],
    function (err) {
      if (err) {
        req.flash('error', 'Could not initiate top-up.');
        return res.redirect('/dashboard');
      }

      const autoApprove = String(process.env.PAYMENT_MODE || '').toLowerCase() === 'mock';
      if (!autoApprove) {
        req.flash('error', 'Gateway API is not configured yet. Please set credentials and switch PAYMENT_MODE=live.');
        return res.redirect('/dashboard');
      }

      const topupId = this.lastID;
      db.run("UPDATE wallet_topups SET status='paid', paid_at=CURRENT_TIMESTAMP WHERE id=?", [topupId], () => {
        db.run("UPDATE users SET wallet_balance = wallet_balance + ? WHERE id=?", [amount, uid], () => {
          recordWalletTx(uid, amount, 'topup', 'wallet_topup', topupId, `${gateway} top-up`);
          req.flash('success', 'Wallet topped up successfully.');
          return res.redirect('/dashboard');
        });
      });
    }
  );
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
    hotel_id, hotel_name, check_in, check_out, persons, total_price, return_to
  } = req.body;
  const returnTo = safeReturnTo(return_to);
  const amount = Number(total_price || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    req.flash('error', 'Invalid booking amount.');
    return res.redirect('/hotels');
  }
  const userFee = calcUserFee(amount);
  const totalCharge = amount + userFee;

  withTransaction((finish) => {
    getProviderUserId('hotel', hotel_id, (ownerErr, ownerId) => {
      if (ownerErr) return finish(ownerErr);
      db.get("SELECT wallet_balance FROM users WHERE id=?", [req.session.user.id], (walletErr, me) => {
        if (walletErr || !me) return finish(walletErr || new Error('WALLET_NOT_FOUND'));
        if ((me.wallet_balance || 0) < totalCharge) return finish(new Error('INSUFFICIENT_BALANCE'));

        db.run(
          "UPDATE users SET wallet_balance = wallet_balance - ? WHERE id=? AND wallet_balance >= ?",
          [totalCharge, req.session.user.id, totalCharge],
          function (debitErr) {
            if (debitErr || this.changes === 0) return finish(debitErr || new Error('WALLET_DEBIT_FAILED'));

            db.run(
              "INSERT INTO bookings (user_id, type, item_id, item_name, check_in, check_out, persons, total_price, payment_method, payment_status, payment_fee, escrow_status, paid_at) VALUES (?,?,?,?,?,?,?,?,?,'held',?,'held',CURRENT_TIMESTAMP)",
              [req.session.user.id, 'hotel', hotel_id, hotel_name, check_in, check_out, persons, amount, 'wallet', userFee],
              function (insertErr) {
                if (insertErr) return finish(insertErr);
                const bookingId = this.lastID;
                const commissionRate = commissionRateFor('hotel');
                const commissionAmount = Math.round(amount * commissionRate);
                db.run(
                  "INSERT INTO escrow_payments (booking_id, payer_id, provider_user_id, amount, user_fee_amount, provider_commission_rate, provider_commission_amount, status) VALUES (?,?,?,?,?,?,?,'held')",
                  [bookingId, req.session.user.id, ownerId, amount, userFee, commissionRate, commissionAmount],
                  function (escrowErr) {
                    if (escrowErr) return finish(escrowErr);
                    recordWalletTx(req.session.user.id, -totalCharge, 'booking_debit', 'booking', bookingId, 'Hotel booking');
                    if (userFee > 0) {
                      return getAdminUserId((adminId) => {
                        if (!adminId) return finish(null);
                        db.run("UPDATE users SET wallet_balance = wallet_balance + ? WHERE id=?", [userFee, adminId], () => {
                          recordWalletTx(adminId, userFee, 'user_fee', 'booking', bookingId, 'User booking fee');
                          return finish(null);
                        });
                      });
                    }
                    return finish(null);
                  }
                );
              }
            );
          }
        );
      });
    });
  }, (txErr) => {
    if (txErr) {
      if (txErr.message === 'INSUFFICIENT_BALANCE') {
        req.flash('error', 'Not enough wallet balance. Please top up your wallet.');
      } else {
        req.flash('error', 'Could not complete hotel booking. Please try again.');
      }
      return res.redirect('/hotels');
    }
    req.flash('success', 'Hotel booked successfully! Payment is held in escrow.');
    return res.redirect(returnTo || '/dashboard');
  });
});

router.get('/transport/:id', (req, res) => {
  const transportId = parseInt(req.params.id, 10);
  const returnTo = safeReturnTo(req.query.return);
  if (!Number.isInteger(transportId) || transportId <= 0) return res.redirect('/transport');

  db.get("SELECT * FROM transport WHERE id = ?", [transportId], (err, transport) => {
    if (err || !transport) return res.redirect('/transport');

    db.all(
      "SELECT * FROM transport_seats WHERE transport_id=? ORDER BY id ASC",
      [transportId],
      (seatErr, seats) => {
        const totalSeats = Number(transport.seats_available || 0);
        if (!seatErr && (!seats || seats.length === 0) && totalSeats > 0) {
          const stmt = db.prepare("INSERT INTO transport_seats (transport_id, seat_no, is_booked) VALUES (?,?,0)");
          for (let i = 1; i <= totalSeats; i += 1) {
            stmt.run([transportId, String(i)]);
          }
          stmt.finalize(() => {
            db.all(
              "SELECT * FROM transport_seats WHERE transport_id=? ORDER BY id ASC",
              [transportId],
              (seatErr2, seats2) => {
                res.render('user/transport-detail', {
                  title: `${transport.company || transport.type} - Details`,
                  transport,
                  seats: seats2 || [],
                  returnTo,
                  user: req.session.user
                });
              }
            );
          });
          return;
        }

        res.render('user/transport-detail', {
          title: `${transport.company || transport.type} - Details`,
          transport,
          seats: seats || [],
          returnTo,
          user: req.session.user
        });
      }
    );
  });
});

// Book Transport
router.post('/book/transport', isAuth, (req, res) => {
  const {
    transport_id, transport_name, travel_date, persons, return_to, seat_numbers
  } = req.body;
  const transportId = parseInt(transport_id, 10);
  const seatList = String(seat_numbers || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const personsCount = seatList.length ? seatList.length : parseInt(persons, 10);
  const returnTo = safeReturnTo(return_to);
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
  if (seatList.length === 0) {
    req.flash('error', 'Please select at least one seat.');
    return res.redirect('/transport');
  }
  const todayStr = new Date().toISOString().split('T')[0];
  if (travel_date < todayStr) {
    req.flash('error', 'Travel date cannot be in the past.');
    return res.redirect('/transport');
  }
  withTransaction((finish) => {
    db.get(
      "SELECT id, type, company, from_location, to_location, departure_time, price, seats_available, owner_user_id FROM transport WHERE id=?",
      [transportId],
      (err, transport) => {
        if (err || !transport) return finish(new Error('NOT_FOUND'));
        if ((transport.seats_available || 0) < personsCount) return finish(new Error('NOT_ENOUGH_SEATS'));

        const isBus = String(transport.type || '').toLowerCase().includes('bus');
        const isFemale = String((req.session.user && req.session.user.gender) || '').toLowerCase() === 'female';
        const reservedSet = new Set(['1', '2', '3', '4']);
        const hasReserved = isBus && seatList.some(s => reservedSet.has(String(s)));

        const placeholders = seatList.map(() => '?').join(',');
        db.all(
          `SELECT id, seat_no, is_booked FROM transport_seats
           WHERE transport_id=? AND seat_no IN (${placeholders})`,
          [transportId, ...seatList],
          (seatErr, rows) => {
            if (seatErr || !rows || rows.length !== seatList.length) return finish(new Error('SEAT_MISMATCH'));
            const hasBooked = rows.some(r => r.is_booked);
            if (hasBooked) return finish(new Error('SEAT_TAKEN'));

            const calculatedTotal = Number(transport.price || 0) * personsCount;
            const userFee = calcUserFee(calculatedTotal);
            const totalCharge = calculatedTotal + userFee;
            const safeTransportName =
              `${transport.company || transport_name || transport.type} - ${transport.from_location} to ${transport.to_location}`;

            const warningNote = (!isFemale && hasReserved)
              ? 'Reserved seats are for women only. Non-refundable and not allowed to sit in reserved seats.'
              : null;
            db.get("SELECT wallet_balance FROM users WHERE id=?", [req.session.user.id], (walletErr, me) => {
              if (walletErr || !me) return finish(walletErr || new Error('WALLET_NOT_FOUND'));
              if ((me.wallet_balance || 0) < totalCharge) return finish(new Error('INSUFFICIENT_BALANCE'));

              db.run(
                "UPDATE users SET wallet_balance = wallet_balance - ? WHERE id=? AND wallet_balance >= ?",
                [totalCharge, req.session.user.id, totalCharge],
                function (debitErr) {
                  if (debitErr || this.changes === 0) return finish(debitErr || new Error('WALLET_DEBIT_FAILED'));

                  db.run(
                    "INSERT INTO bookings (user_id, type, item_id, item_name, check_in, persons, total_price, seat_numbers, notes, payment_method, payment_status, payment_fee, escrow_status, paid_at) VALUES (?,?,?,?,?,?,?,?,?,?,'held',?,'held',CURRENT_TIMESTAMP)",
                    [req.session.user.id, 'transport', transport.id, safeTransportName, travel_date, personsCount, calculatedTotal, seatList.join(','), warningNote, 'wallet', userFee],
                    function (insertErr) {
                      if (insertErr) return finish(insertErr);
                      const bookingId = this.lastID;
                      const commissionRate = commissionRateFor('transport');
                      const commissionAmount = Math.round(calculatedTotal * commissionRate);
                      db.run(
                        "INSERT INTO escrow_payments (booking_id, payer_id, provider_user_id, amount, user_fee_amount, provider_commission_rate, provider_commission_amount, status) VALUES (?,?,?,?,?,?,?,'held')",
                        [bookingId, req.session.user.id, transport.owner_user_id || null, calculatedTotal, userFee, commissionRate, commissionAmount],
                        function (escrowErr) {
                          if (escrowErr) return finish(escrowErr);

                          db.run(
                            `UPDATE transport_seats
                             SET is_booked=1, booking_id=?, booked_at=CURRENT_TIMESTAMP
                             WHERE transport_id=? AND seat_no IN (${placeholders})`,
                            [bookingId, transportId, ...seatList],
                            function (seatUpdateErr) {
                              if (seatUpdateErr) return finish(seatUpdateErr);
                              db.run(
                                "UPDATE transport SET seats_available = seats_available - ? WHERE id=? AND seats_available >= ?",
                                [personsCount, transportId, personsCount],
                                function (availErr) {
                                  if (availErr || this.changes === 0) return finish(availErr || new Error('SEAT_UPDATE_FAIL'));
                                  recordWalletTx(req.session.user.id, -totalCharge, 'booking_debit', 'booking', bookingId, 'Transport booking');
                                  if (userFee > 0) {
                                    return getAdminUserId((adminId) => {
                                      if (!adminId) return finish(null);
                                      db.run("UPDATE users SET wallet_balance = wallet_balance + ? WHERE id=?", [userFee, adminId], () => {
                                        recordWalletTx(adminId, userFee, 'user_fee', 'booking', bookingId, 'User booking fee');
                                        return finish(null);
                                      });
                                    });
                                  }
                                  return finish(null);
                                }
                              );
                            }
                          );
                        }
                      );
                    }
                  );
                }
              );
            });
          }
        );
      }
    );
  }, (txErr) => {
    if (txErr) {
      if (txErr.message === 'NOT_FOUND') {
        req.flash('error', 'Selected transport was not found.');
      } else if (txErr.message === 'NOT_ENOUGH_SEATS') {
        req.flash('error', 'Not enough seats available for this transport.');
      } else if (txErr.message === 'SEAT_TAKEN') {
        req.flash('error', 'One or more selected seats are already booked.');
      } else if (txErr.message === 'SEAT_MISMATCH') {
        req.flash('error', 'Selected seats are not available for this transport.');
      } else if (txErr.message === 'INSUFFICIENT_BALANCE') {
        req.flash('error', 'Not enough wallet balance. Please top up your wallet.');
      } else {
        req.flash('error', 'Could not complete transport booking. Please try again.');
      }
      return res.redirect('/transport');
    }
    req.flash('success', 'Transport booked successfully! Payment is held in escrow.');
    return res.redirect(returnTo || '/dashboard');
  });
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
    guide_id, guide_name, start_date, days, total_price, return_to
  } = req.body;
  const returnTo = safeReturnTo(return_to);
  const amount = Number(total_price || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    req.flash('error', 'Invalid booking amount.');
    return res.redirect('/guides');
  }
  const userFee = calcUserFee(amount);
  const totalCharge = amount + userFee;

  withTransaction((finish) => {
    getProviderUserId('guide', guide_id, (ownerErr, ownerId) => {
      if (ownerErr) return finish(ownerErr);
      db.get("SELECT wallet_balance FROM users WHERE id=?", [req.session.user.id], (walletErr, me) => {
        if (walletErr || !me) return finish(walletErr || new Error('WALLET_NOT_FOUND'));
        if ((me.wallet_balance || 0) < totalCharge) return finish(new Error('INSUFFICIENT_BALANCE'));

        db.run(
          "UPDATE users SET wallet_balance = wallet_balance - ? WHERE id=? AND wallet_balance >= ?",
          [totalCharge, req.session.user.id, totalCharge],
          function (debitErr) {
            if (debitErr || this.changes === 0) return finish(debitErr || new Error('WALLET_DEBIT_FAILED'));

            db.run(
              "INSERT INTO bookings (user_id, type, item_id, item_name, check_in, persons, total_price, payment_method, payment_status, payment_fee, escrow_status, paid_at) VALUES (?,?,?,?,?,?,?,?,?,'held',?,'held',CURRENT_TIMESTAMP)",
              [req.session.user.id, 'guide', guide_id, guide_name, start_date, days, amount, 'wallet', userFee],
              function (insertErr) {
                if (insertErr) return finish(insertErr);
                const bookingId = this.lastID;
                const commissionRate = commissionRateFor('guide');
                const commissionAmount = Math.round(amount * commissionRate);
                db.run(
                  "INSERT INTO escrow_payments (booking_id, payer_id, provider_user_id, amount, user_fee_amount, provider_commission_rate, provider_commission_amount, status) VALUES (?,?,?,?,?,?,?,'held')",
                  [bookingId, req.session.user.id, ownerId, amount, userFee, commissionRate, commissionAmount],
                  function (escrowErr) {
                    if (escrowErr) return finish(escrowErr);
                    recordWalletTx(req.session.user.id, -totalCharge, 'booking_debit', 'booking', bookingId, 'Guide booking');
                    if (userFee > 0) {
                      return getAdminUserId((adminId) => {
                        if (!adminId) return finish(null);
                        db.run("UPDATE users SET wallet_balance = wallet_balance + ? WHERE id=?", [userFee, adminId], () => {
                          recordWalletTx(adminId, userFee, 'user_fee', 'booking', bookingId, 'User booking fee');
                          return finish(null);
                        });
                      });
                    }
                    return finish(null);
                  }
                );
              }
            );
          }
        );
      });
    });
  }, (txErr) => {
    if (txErr) {
      if (txErr.message === 'INSUFFICIENT_BALANCE') {
        req.flash('error', 'Not enough wallet balance. Please top up your wallet.');
      } else {
        req.flash('error', 'Could not complete guide booking. Please try again.');
      }
      return res.redirect('/guides');
    }
    req.flash('success', 'Guide hired successfully! Payment is held in escrow.');
    return res.redirect(returnTo || '/dashboard');
  });
});

// Book Package
router.post('/book/package', isAuth, (req, res) => {
  const {
    pkg_id, pkg_name, travel_date, persons, total_price
  } = req.body;
  const amount = Number(total_price || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    req.flash('error', 'Invalid booking amount.');
    return res.redirect('/packages');
  }
  const userFee = calcUserFee(amount);
  const totalCharge = amount + userFee;

  withTransaction((finish) => {
    getProviderUserId('package', pkg_id, (ownerErr, ownerId) => {
      if (ownerErr) return finish(ownerErr);
      db.get("SELECT wallet_balance FROM users WHERE id=?", [req.session.user.id], (walletErr, me) => {
        if (walletErr || !me) return finish(walletErr || new Error('WALLET_NOT_FOUND'));
        if ((me.wallet_balance || 0) < totalCharge) return finish(new Error('INSUFFICIENT_BALANCE'));

        db.run(
          "UPDATE users SET wallet_balance = wallet_balance - ? WHERE id=? AND wallet_balance >= ?",
          [totalCharge, req.session.user.id, totalCharge],
          function (debitErr) {
            if (debitErr || this.changes === 0) return finish(debitErr || new Error('WALLET_DEBIT_FAILED'));

            db.run(
              "INSERT INTO bookings (user_id, type, item_id, item_name, check_in, persons, total_price, payment_method, payment_status, payment_fee, escrow_status, paid_at) VALUES (?,?,?,?,?,?,?,?,?,'held',?,'held',CURRENT_TIMESTAMP)",
              [req.session.user.id, 'package', pkg_id, pkg_name, travel_date, persons, amount, 'wallet', userFee],
              function (insertErr) {
                if (insertErr) return finish(insertErr);
                const bookingId = this.lastID;
                const commissionRate = commissionRateFor('package');
                const commissionAmount = Math.round(amount * commissionRate);
                db.run(
                  "INSERT INTO escrow_payments (booking_id, payer_id, provider_user_id, amount, user_fee_amount, provider_commission_rate, provider_commission_amount, status) VALUES (?,?,?,?,?,?,?,'held')",
                  [bookingId, req.session.user.id, ownerId, amount, userFee, commissionRate, commissionAmount],
                  function (escrowErr) {
                    if (escrowErr) return finish(escrowErr);
                    recordWalletTx(req.session.user.id, -totalCharge, 'booking_debit', 'booking', bookingId, 'Package booking');
                    if (userFee > 0) {
                      return getAdminUserId((adminId) => {
                        if (!adminId) return finish(null);
                        db.run("UPDATE users SET wallet_balance = wallet_balance + ? WHERE id=?", [userFee, adminId], () => {
                          recordWalletTx(adminId, userFee, 'user_fee', 'booking', bookingId, 'User booking fee');
                          return finish(null);
                        });
                      });
                    }
                    return finish(null);
                  }
                );
              }
            );
          }
        );
      });
    });
  }, (txErr) => {
    if (txErr) {
      if (txErr.message === 'INSUFFICIENT_BALANCE') {
        req.flash('error', 'Not enough wallet balance. Please top up your wallet.');
      } else {
        req.flash('error', 'Could not complete package booking. Please try again.');
      }
      return res.redirect('/packages');
    }
    req.flash('success', 'Package booked! Payment is held in escrow.');
    return res.redirect('/dashboard');
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
  db.get(
    `SELECT b.id, b.status, b.exchange_locked, b.payment_fee, b.total_price,
            e.id as escrow_id, e.status as escrow_status, e.amount as escrow_amount
     FROM bookings b
     LEFT JOIN escrow_payments e ON e.booking_id = b.id
     WHERE b.id=? AND b.user_id=?`,
    [req.params.id, req.session.user.id],
    (err, booking) => {
      if (err || !booking) {
        req.flash('error', 'Booking not found.');
        return res.redirect('/dashboard');
      }
      if (booking.exchange_locked) {
        req.flash('error', 'This exchanged ticket cannot be cancelled by user.');
        return res.redirect('/dashboard');
      }

      const refundAmount = Number(booking.escrow_amount || booking.total_price || 0);
      const refundFee = Number(booking.payment_fee || 0);
      const totalRefund = refundAmount + refundFee;

      withTransaction((finish) => {
        db.run("UPDATE bookings SET status='cancelled', escrow_status='refunded' WHERE id=? AND user_id=?", [booking.id, req.session.user.id], (updErr) => {
          if (updErr) return finish(updErr);
          if (booking.escrow_id && booking.escrow_status === 'held') {
            db.run("UPDATE escrow_payments SET status='refunded', released_at=CURRENT_TIMESTAMP WHERE id=?", [booking.escrow_id], (escrowErr) => {
              if (escrowErr) return finish(escrowErr);
              if (totalRefund > 0) {
                db.run("UPDATE users SET wallet_balance = wallet_balance + ? WHERE id=?", [totalRefund, req.session.user.id], () => {
                  recordWalletTx(req.session.user.id, totalRefund, 'refund', 'booking', booking.id, 'Booking refund');
                  return finish(null);
                });
              } else {
                return finish(null);
              }
            });
          } else {
            return finish(null);
          }
        });
      }, (txErr) => {
        if (txErr) {
          req.flash('error', 'Could not cancel booking. Please try again.');
          return res.redirect('/dashboard');
        }
        req.flash('success', 'Booking cancelled successfully.');
        return res.redirect('/dashboard');
      });
    }
  );
});

router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err) {
    req.flash('error', err.message || 'File upload failed.');
    return res.redirect(req.get('referer') || '/dashboard');
  }
  next(err);
});

module.exports = router;
