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
  if (value === 'wallet' || value === 'bkash' || value === 'nagad') return value;
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

function getWalletTopupGatewayInfo(gateway) {
  const normalized = String(gateway || '').toLowerCase();
  if (normalized === 'nagad') {
    return {
      label: 'Nagad',
      merchantName: 'TouristiX Wallet Recharge',
      merchantNumber: '01753340990'
    };
  }
  return {
    label: 'bKash',
    merchantName: 'TouristiX Wallet Recharge',
    merchantNumber: '01753340989'
  };
}

function normalizeCoTravelers(rawValue, travelerCount) {
  const maxCoTravelers = Math.max(0, Number(travelerCount || 0) - 1);
  if (!maxCoTravelers) return '';

  let parsed = [];
  try {
    parsed = JSON.parse(String(rawValue || '[]'));
  } catch (err) {
    parsed = [];
  }
  if (!Array.isArray(parsed)) return '';

  const cleaned = parsed
    .slice(0, maxCoTravelers)
    .map((item) => {
      const name = String(item?.name || '').trim();
      const ageText = String(item?.age || '').trim();
      const gender = String(item?.gender || '').trim();
      const phone = String(item?.phone || '').trim();
      const relation = String(item?.relation || '').trim();
      const age = /^\d{1,3}$/.test(ageText) ? ageText : '';
      if (!name && !age && !gender && !phone && !relation) return null;
      return { name, age, gender, phone, relation };
    })
    .filter(Boolean);

  return cleaned.length ? JSON.stringify(cleaned) : '';
}

function parseCoTravelers(rawValue) {
  try {
    const parsed = JSON.parse(String(rawValue || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function buildTicketNumber(booking) {
  const typeCode = String(booking?.type || 'trip').slice(0, 3).toUpperCase();
  const idText = String(booking?.id || 0).padStart(6, '0');
  return `BT-${typeCode}-${idText}`;
}

function getMerchantDisplayName(type, itemName) {
  const normalizedType = String(type || '').trim().toLowerCase();
  const rawName = String(itemName || '').trim();
  if (!rawName) return 'TouristiX Merchant';
  if (normalizedType === 'transport') {
    const [companyName] = rawName.split(' - ');
    return companyName || rawName;
  }
  return rawName;
}

function getServicePaymentInfo(type, method, itemName) {
  const normalizedType = String(type || '').trim().toLowerCase();
  const normalizedMethod = String(method || '').trim().toLowerCase();
  const merchantDisplayName = getMerchantDisplayName(normalizedType, itemName);

  if (normalizedMethod === 'wallet') {
    return {
      serviceLabel:
        normalizedType === 'hotel' ? 'Hotel Stay Payment' :
        normalizedType === 'guide' ? 'Guide Hire Payment' :
        normalizedType === 'package' ? 'Package Purchase Payment' :
        'Transport Ticket Payment',
      merchantName: 'TouristiX Wallet',
      merchantNumber: 'Internal wallet balance',
      paymentLabel: 'Wallet'
    };
  }

  const gatewayLabel = normalizedMethod === 'nagad' ? 'Nagad' : 'bKash';
  return {
    serviceLabel:
      normalizedType === 'hotel' ? 'Hotel Booking Gateway' :
      normalizedType === 'guide' ? 'Guide Hire Gateway' :
      normalizedType === 'package' ? 'Package Purchase Gateway' :
      'Transport Ticket Gateway',
    merchantName: merchantDisplayName,
    merchantNumber:
      normalizedType === 'hotel' ? '01753340981' :
      normalizedType === 'guide' ? '01753340982' :
      normalizedType === 'package' ? '01753340983' :
      '01753340968',
    paymentLabel: gatewayLabel
  };
}

function creditBookingFeeToAdmin(userFee, bookingId, cb) {
  if (!(Number(userFee) > 0)) return cb(null);
  return getAdminUserId((adminId) => {
    if (!adminId) return cb(null);
    db.run("UPDATE users SET wallet_balance = wallet_balance + ? WHERE id=?", [userFee, adminId], (err) => {
      if (err) return cb(err);
      recordWalletTx(adminId, userFee, 'user_fee', 'booking', bookingId, 'User booking fee');
      return cb(null);
    });
  });
}

const USER_FEE_RATE = 0.01;
const COMMISSION_RATES = {
  hotel: 0.05,
  transport: 0.02,
  guide: 0.03,
  package: 0
};

function calcUserFee(amount) {
  const fee = Math.ceil(Number(amount || 0) * USER_FEE_RATE);
  return Number.isFinite(fee) ? fee : 0;
}

function normalizeCouponCode(code) {
  return String(code || '').trim().toUpperCase().replace(/\s+/g, '');
}

function resolveBookingCoupon(userId, rawCode, grossAmount, cb) {
  const code = normalizeCouponCode(rawCode);
  const amount = Math.max(0, Math.round(Number(grossAmount || 0)));
  if (!code) {
    const userFee = calcUserFee(amount);
    return cb(null, {
      coupon: null,
      couponCode: null,
      discount: 0,
      amount,
      userFee,
      totalCharge: amount + userFee
    });
  }

  db.get(
    `SELECT * FROM coupons
     WHERE user_id=? AND code=? AND status='active'
       AND (expires_at IS NULL OR datetime(expires_at) >= datetime('now'))
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, code],
    (err, coupon) => {
      if (err) return cb(err);
      if (!coupon) return cb(new Error('INVALID_COUPON'));
      if (amount < Number(coupon.min_order_amount || 0)) return cb(new Error('COUPON_MIN_ORDER'));

      let discount = 0;
      if (String(coupon.discount_type || 'percent') === 'fixed') {
        discount = Number(coupon.discount_value || 0);
      } else {
        discount = Math.floor(amount * (Number(coupon.discount_value || 0) / 100));
      }
      if (Number(coupon.max_discount || 0) > 0) {
        discount = Math.min(discount, Number(coupon.max_discount || 0));
      }
      discount = Math.max(0, Math.min(amount, Math.round(discount)));
      if (!discount) return cb(new Error('INVALID_COUPON'));

      const discountedAmount = Math.max(0, amount - discount);
      const userFee = calcUserFee(discountedAmount);
      return cb(null, {
        coupon,
        couponCode: coupon.code,
        discount,
        amount: discountedAmount,
        userFee,
        totalCharge: discountedAmount + userFee
      });
    }
  );
}

function markCouponUsed(couponId, bookingId, cb) {
  if (!couponId) return cb(null);
  db.run(
    "UPDATE coupons SET status='used', used_at=CURRENT_TIMESTAMP, used_booking_id=? WHERE id=? AND status='active'",
    [bookingId, couponId],
    function (err) {
      if (err) return cb(err);
      if (this.changes === 0) return cb(new Error('COUPON_USE_FAILED'));
      return cb(null);
    }
  );
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

function updateWalletBalance(userId, amount, cb) {
  const normalizedAmount = Math.round(Number(amount || 0));
  if (!normalizedAmount) return cb(null);

  if (normalizedAmount > 0) {
    return db.run(
      "UPDATE users SET wallet_balance = wallet_balance + ? WHERE id=?",
      [normalizedAmount, userId],
      function (err) {
        if (err || this.changes === 0) return cb(err || new Error('WALLET_CREDIT_FAILED'));
        return cb(null);
      }
    );
  }

  const debitAmount = Math.abs(normalizedAmount);
  return db.run(
    "UPDATE users SET wallet_balance = wallet_balance - ? WHERE id=? AND wallet_balance >= ?",
    [debitAmount, userId, debitAmount],
    function (err) {
      if (err || this.changes === 0) return cb(err || new Error('WALLET_DEBIT_FAILED'));
      return cb(null);
    }
  );
}

function getWalletBalance(userId, cb) {
  db.get("SELECT wallet_balance FROM users WHERE id=?", [userId], (err, row) => {
    if (err || !row) return cb(err || new Error('WALLET_NOT_FOUND'));
    return cb(null, Number(row.wallet_balance || 0));
  });
}

function settleBookingFunds(bookingId, payerId, providerUserId, bookingAmount, userFee, commissionRate, cb) {
  getAdminUserId((adminId) => {
    if (!adminId) return cb(new Error('ADMIN_NOT_FOUND'));

    const effectiveProviderId = providerUserId || adminId;
    const amount = Math.max(0, Math.round(Number(bookingAmount || 0)));
    const feeAmount = Math.max(0, Math.round(Number(userFee || 0)));
    const rate = Number(commissionRate || 0);
    const commissionAmount = effectiveProviderId === adminId ? 0 : Math.round(amount * rate);
    const partnerPayout = Math.max(0, amount - commissionAmount);

    db.run(
      `INSERT INTO escrow_payments
       (booking_id, payer_id, provider_user_id, amount, user_fee_amount, provider_commission_rate, provider_commission_amount, status, released_at)
       VALUES (?,?,?,?,?,?,?,'paid_out',CURRENT_TIMESTAMP)`,
      [bookingId, payerId, effectiveProviderId, amount, feeAmount, rate, commissionAmount],
      function (insertErr) {
        if (insertErr) return cb(insertErr);
        const payoutLedgerId = this.lastID;

        const creditCommission = () => {
          if (!(commissionAmount > 0)) return creditUserFee();
          updateWalletBalance(adminId, commissionAmount, (commissionErr) => {
            if (commissionErr) return cb(commissionErr);
            recordWalletTx(adminId, commissionAmount, 'commission', 'booking', bookingId, 'Direct booking commission', (txErr) => {
              if (txErr) return cb(txErr);
              return creditUserFee();
            });
          });
        };

        const creditUserFee = () => {
          if (!(feeAmount > 0)) return cb(null, { payoutLedgerId, adminId, effectiveProviderId, partnerPayout, commissionAmount, feeAmount });
          updateWalletBalance(adminId, feeAmount, (feeErr) => {
            if (feeErr) return cb(feeErr);
            recordWalletTx(adminId, feeAmount, 'user_fee', 'booking', bookingId, 'User booking fee', (txErr) => {
              if (txErr) return cb(txErr);
              return cb(null, { payoutLedgerId, adminId, effectiveProviderId, partnerPayout, commissionAmount, feeAmount });
            });
          });
        };

        if (!(partnerPayout > 0)) return creditCommission();
        updateWalletBalance(effectiveProviderId, partnerPayout, (payoutErr) => {
          if (payoutErr) return cb(payoutErr);
          recordWalletTx(effectiveProviderId, partnerPayout, 'payout', 'booking', bookingId, 'Direct booking payout', (txErr) => {
            if (txErr) return cb(txErr);
            return creditCommission();
          });
        });
      }
    );
  });
}

function refundBookingSettlement(bookingId, userId, bookingAmount, paymentFee, escrowRecord, note, cb) {
  getAdminUserId((adminId) => {
    if (!adminId) return cb(new Error('ADMIN_NOT_FOUND'));

    const escrow = escrowRecord || {};
    const amount = Math.max(0, Math.round(Number(escrow.amount || bookingAmount || 0)));
    const feeAmount = Math.max(0, Math.round(Number(escrow.user_fee_amount || paymentFee || 0)));
    const effectiveProviderId = escrow.provider_user_id || adminId;
    const escrowStatus = String(escrow.status || 'paid_out').toLowerCase();
    const commissionAmount = effectiveProviderId === adminId ? 0 : Math.max(0, Math.round(Number(escrow.provider_commission_amount || 0)));
    const partnerPayout = Math.max(0, amount - commissionAmount);
    const totalRefund = amount + feeAmount;

    const verifyReversalBalances = (next) => {
      const needsProviderDebit = partnerPayout > 0 && ['paid_out', 'released'].includes(escrowStatus);
      const needsAdminDebit = (commissionAmount > 0 || feeAmount > 0) && ['paid_out', 'released'].includes(escrowStatus);

      const checkAdmin = () => {
        if (!needsAdminDebit) return next(null);
        const adminNeed = commissionAmount + feeAmount;
        getWalletBalance(adminId, (adminErr, adminBalance) => {
          if (adminErr) return next(adminErr);
          if (adminBalance < adminNeed) return next(new Error('REFUND_PENDING_INSUFFICIENT_FUNDS'));
          return next(null);
        });
      };

      if (!needsProviderDebit) return checkAdmin();
      getWalletBalance(effectiveProviderId, (providerErr, providerBalance) => {
        if (providerErr) return next(providerErr);
        if (providerBalance < partnerPayout) return next(new Error('REFUND_PENDING_INSUFFICIENT_FUNDS'));
        return checkAdmin();
      });
    };

    const reverseUserFee = (next) => {
      if (!(feeAmount > 0)) return next(null);
      updateWalletBalance(adminId, -feeAmount, (feeErr) => {
        if (feeErr) return next(feeErr);
        recordWalletTx(adminId, -feeAmount, 'user_fee_reversal', 'booking', bookingId, 'Booking fee refund reversal', (txErr) => next(txErr || null));
      });
    };

    const reverseCommission = (next) => {
      if (!(commissionAmount > 0) || !['paid_out', 'released'].includes(escrowStatus)) return next(null);
      updateWalletBalance(adminId, -commissionAmount, (commissionErr) => {
        if (commissionErr) return next(commissionErr);
        recordWalletTx(adminId, -commissionAmount, 'commission_reversal', 'booking', bookingId, 'Booking commission refund reversal', (txErr) => next(txErr || null));
      });
    };

    const reversePartnerPayout = (next) => {
      if (!(partnerPayout > 0) || !['paid_out', 'released'].includes(escrowStatus)) return next(null);
      updateWalletBalance(effectiveProviderId, -partnerPayout, (payoutErr) => {
        if (payoutErr) return next(payoutErr);
        recordWalletTx(effectiveProviderId, -partnerPayout, 'payout_reversal', 'booking', bookingId, 'Booking payout refund reversal', (txErr) => next(txErr || null));
      });
    };

    verifyReversalBalances((verifyErr) => {
      if (verifyErr) return cb(verifyErr);
      reversePartnerPayout((partnerErr) => {
        if (partnerErr) return cb(partnerErr);
        reverseCommission((commissionErr) => {
          if (commissionErr) return cb(commissionErr);
          reverseUserFee((feeErr) => {
            if (feeErr) return cb(feeErr);
            if (!(totalRefund > 0)) return cb(null);
            updateWalletBalance(userId, totalRefund, (refundErr) => {
              if (refundErr) return cb(refundErr);
              recordWalletTx(userId, totalRefund, 'refund', 'booking', bookingId, note || 'Booking refund', (txErr) => cb(txErr || null));
            });
          });
        });
      });
    });
  });
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
     WHERE bp.status='approved'
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
    "INSERT INTO blog_posts (user_id, title, content, media_urls, status) VALUES (?,?,?,?, 'pending')",
    [req.session.user.id, title, content, mediaText],
    (err) => {
      if (err) {
        req.flash('error', 'Could not publish blog post. Please try again.');
        return res.redirect('/blog');
      }
      req.flash('success', 'Blog post submitted successfully. It is now waiting for admin approval.');
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
          db.all("SELECT * FROM coupons WHERE user_id=? ORDER BY CASE WHEN status='active' THEN 0 ELSE 1 END, created_at DESC", [uid], (err4, coupons) => {
            db.all("SELECT * FROM wallet_topups WHERE user_id=? ORDER BY created_at DESC LIMIT 8", [uid], (err5, walletTopups) => {
              const mappedBookings = (bookings || []).map((booking) => ({
                ...booking,
                ticket_number: buildTicketNumber(booking),
                coTravelers: parseCoTravelers(booking.co_travelers)
              }));
              res.render('user/dashboard', {
                title: 'My Dashboard',
                profile: profile || null,
                bookings: mappedBookings,
                favorites: favs || [],
                walletBalance: (profile && profile.wallet_balance) || 0,
                walletTx: walletTx || [],
                walletTopups: walletTopups || [],
                walletTopupMode: String(process.env.PAYMENT_MODE || '').toLowerCase() === 'mock' ? 'mock' : 'live',
                walletTopupGatewayInfo: {
                  bkash: getWalletTopupGatewayInfo('bkash'),
                  nagad: getWalletTopupGatewayInfo('nagad')
                },
                coupons: coupons || [],
                user: req.session.user
              });
            });
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
  const paymentNumber = normalizePaymentNumber(req.body.payment_number);
  const paymentTxnId = normalizePaymentTxnId(req.body.payment_txn_id);

  if (!gateway) {
    req.flash('error', 'Please select bKash or Nagad for top-up.');
    return res.redirect('/dashboard');
  }
  if (!Number.isInteger(amount) || amount < 100) {
    req.flash('error', 'Please enter a valid top-up amount of at least BDT 100.');
    return res.redirect('/dashboard');
  }
  if (!paymentNumber) {
    req.flash('error', 'Please enter the mobile number used for this payment.');
    return res.redirect('/dashboard');
  }
  if (!paymentTxnId) {
    req.flash('error', 'Please enter a valid transaction ID.');
    return res.redirect('/dashboard');
  }

  const gatewayRef = buildGatewayRef(gateway);
  db.run(
    "INSERT INTO wallet_topups (user_id, gateway, amount, status, gateway_ref, payment_number, payment_txn_id) VALUES (?,?,?,?,?,?,?)",
    [uid, gateway, amount, 'pending', gatewayRef, paymentNumber, paymentTxnId],
    function (err) {
      if (err) {
        req.flash('error', 'Could not initiate top-up.');
        return res.redirect('/dashboard');
      }

      const autoApprove = String(process.env.PAYMENT_MODE || '').toLowerCase() === 'mock';
      if (!autoApprove) {
        req.flash('success', `Top-up request submitted and is pending verification. Reference: ${gatewayRef}`);
        return res.redirect('/dashboard');
      }

      const topupId = this.lastID;
      db.run("UPDATE wallet_topups SET status='paid', paid_at=CURRENT_TIMESTAMP WHERE id=?", [topupId], () => {
        db.run("UPDATE users SET wallet_balance = wallet_balance + ? WHERE id=?", [amount, uid], () => {
          recordWalletTx(uid, amount, 'topup', 'wallet_topup', topupId, `${gateway} top-up (${paymentTxnId})`);
          req.flash('success', `Wallet topped up successfully. Reference: ${gatewayRef}`);
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
    hotel_id, hotel_name, check_in, check_out, persons, total_price, return_to, payment_method, co_travelers, coupon_code
  } = req.body;
  const returnTo = safeReturnTo(return_to);
  const paymentMethod = normalizePaymentMethod(payment_method || 'wallet');
  const personCount = Math.max(1, parseInt(persons, 10) || 1);
  const coTravelersJson = normalizeCoTravelers(co_travelers, personCount);
  const amount = Number(total_price || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    req.flash('error', 'Invalid booking amount.');
    return res.redirect('/hotels');
  }
  if (!paymentMethod) {
    req.flash('error', 'Please select a valid payment method.');
    return res.redirect('/hotels');
  }
  const gatewayRef = paymentMethod === 'wallet' ? null : buildGatewayRef(paymentMethod);

  withTransaction((finish) => {
    resolveBookingCoupon(req.session.user.id, coupon_code, amount, (couponErr, pricing) => {
      if (couponErr) return finish(couponErr);
      getProviderUserId('hotel', hotel_id, (ownerErr, ownerId) => {
        if (ownerErr) return finish(ownerErr);
        const { amount: finalAmount, userFee, totalCharge, discount, coupon, couponCode } = pricing;
        const finalizeBooking = () => {
        db.run(
          "INSERT INTO bookings (user_id, type, item_id, item_name, check_in, check_out, persons, total_price, status, payment_method, payment_status, payment_fee, payment_gateway_ref, co_travelers, coupon_code, coupon_discount, escrow_status, paid_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'paid_out',CURRENT_TIMESTAMP)",
          [req.session.user.id, 'hotel', hotel_id, hotel_name, check_in, check_out, personCount, finalAmount, 'confirmed', paymentMethod, 'paid', userFee, gatewayRef, coTravelersJson, couponCode, discount],
          function (insertErr) {
            if (insertErr) return finish(insertErr);
            const bookingId = this.lastID;
            const commissionRate = commissionRateFor('hotel');
            settleBookingFunds(bookingId, req.session.user.id, ownerId, finalAmount, userFee, commissionRate, (settlementErr) => {
              if (settlementErr) return finish(settlementErr);
              if (paymentMethod === 'wallet') {
                recordWalletTx(req.session.user.id, -totalCharge, 'booking_debit', 'booking', bookingId, 'Hotel booking');
              }
              return markCouponUsed(coupon?.id, bookingId, finish);
            });
          }
        );
        };

        if (paymentMethod !== 'wallet') return finalizeBooking();

        db.get("SELECT wallet_balance FROM users WHERE id=?", [req.session.user.id], (walletErr, me) => {
          if (walletErr || !me) return finish(walletErr || new Error('WALLET_NOT_FOUND'));
          if ((me.wallet_balance || 0) < totalCharge) return finish(new Error('INSUFFICIENT_BALANCE'));

          db.run(
            "UPDATE users SET wallet_balance = wallet_balance - ? WHERE id=? AND wallet_balance >= ?",
            [totalCharge, req.session.user.id, totalCharge],
            function (debitErr) {
              if (debitErr || this.changes === 0) return finish(debitErr || new Error('WALLET_DEBIT_FAILED'));
              return finalizeBooking();
            }
          );
        });
      });
    });
  }, (txErr) => {
    if (txErr) {
      if (txErr.message === 'INSUFFICIENT_BALANCE') {
        req.flash('error', 'Not enough wallet balance. Please top up your wallet.');
      } else if (txErr.message === 'INVALID_COUPON') {
        req.flash('error', 'Coupon code is invalid, expired, or already used.');
      } else if (txErr.message === 'COUPON_MIN_ORDER') {
        req.flash('error', 'This coupon requires a higher booking amount.');
      } else {
        req.flash('error', 'Could not complete hotel booking. Please try again.');
      }
      return res.redirect('/hotels');
    }
    req.flash('success', paymentMethod === 'wallet'
      ? 'Hotel booked and confirmed successfully using your wallet! Partner payout and admin commission were sent instantly.'
      : `Hotel booked and confirmed successfully! ${paymentMethod === 'bkash' ? 'bKash' : 'Nagad'} payment was completed automatically and the payout split was sent instantly.`);
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
    transport_id, transport_name, travel_date, persons, return_to, seat_numbers, payment_method, co_travelers, coupon_code
  } = req.body;
  const transportId = parseInt(transport_id, 10);
  const paymentMethod = normalizePaymentMethod(payment_method || 'wallet');
  const seatList = String(seat_numbers || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const personsCount = seatList.length ? seatList.length : parseInt(persons, 10);
  const returnTo = safeReturnTo(return_to);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(String(travel_date || ''));
  const isValidPersons = Number.isInteger(personsCount) && personsCount >= 1 && personsCount <= 10;
  const coTravelersJson = normalizeCoTravelers(co_travelers, personsCount);

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
  if (!paymentMethod) {
    req.flash('error', 'Please select a valid payment method.');
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
            const gatewayRef = paymentMethod === 'wallet' ? null : buildGatewayRef(paymentMethod);
            const safeTransportName =
              `${transport.company || transport_name || transport.type} - ${transport.from_location} to ${transport.to_location}`;

            const warningNote = (!isFemale && hasReserved)
              ? 'Reserved seats are for women only. Non-refundable and not allowed to sit in reserved seats.'
              : null;
            resolveBookingCoupon(req.session.user.id, coupon_code, calculatedTotal, (couponErr, pricing) => {
              if (couponErr) return finish(couponErr);
              const { amount: finalAmount, userFee, totalCharge, discount, coupon, couponCode } = pricing;
              const finalizeBooking = () => {
              db.run(
                "INSERT INTO bookings (user_id, type, item_id, item_name, check_in, persons, total_price, seat_numbers, notes, status, payment_method, payment_status, payment_fee, payment_gateway_ref, co_travelers, coupon_code, coupon_discount, escrow_status, paid_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'paid_out',CURRENT_TIMESTAMP)",
                [req.session.user.id, 'transport', transport.id, safeTransportName, travel_date, personsCount, finalAmount, seatList.join(','), warningNote, 'confirmed', paymentMethod, 'paid', userFee, gatewayRef, coTravelersJson, couponCode, discount],
                function (insertErr) {
                  if (insertErr) return finish(insertErr);
                  const bookingId = this.lastID;
                  const commissionRate = commissionRateFor('transport');
                  settleBookingFunds(bookingId, req.session.user.id, transport.owner_user_id || null, finalAmount, userFee, commissionRate, (settlementErr) => {
                    if (settlementErr) return finish(settlementErr);

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
                            if (paymentMethod === 'wallet') {
                              recordWalletTx(req.session.user.id, -totalCharge, 'booking_debit', 'booking', bookingId, 'Transport booking');
                            }
                            return markCouponUsed(coupon?.id, bookingId, finish);
                          }
                        );
                      }
                    );
                  });
                }
              );
              };

              if (paymentMethod !== 'wallet') return finalizeBooking();

              db.get("SELECT wallet_balance FROM users WHERE id=?", [req.session.user.id], (walletErr, me) => {
                if (walletErr || !me) return finish(walletErr || new Error('WALLET_NOT_FOUND'));
                if ((me.wallet_balance || 0) < totalCharge) return finish(new Error('INSUFFICIENT_BALANCE'));

                db.run(
                  "UPDATE users SET wallet_balance = wallet_balance - ? WHERE id=? AND wallet_balance >= ?",
                  [totalCharge, req.session.user.id, totalCharge],
                  function (debitErr) {
                    if (debitErr || this.changes === 0) return finish(debitErr || new Error('WALLET_DEBIT_FAILED'));
                    return finalizeBooking();
                  }
                );
              });
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
      } else if (txErr.message === 'INVALID_COUPON') {
        req.flash('error', 'Coupon code is invalid, expired, or already used.');
      } else if (txErr.message === 'COUPON_MIN_ORDER') {
        req.flash('error', 'This coupon requires a higher booking amount.');
      } else {
        req.flash('error', 'Could not complete transport booking. Please try again.');
      }
      return res.redirect('/transport');
    }
    req.flash('success', paymentMethod === 'wallet'
      ? 'Transport booked and confirmed successfully using your wallet! Partner payout and admin commission were sent instantly.'
      : `Transport booked and confirmed successfully! ${paymentMethod === 'bkash' ? 'bKash' : 'Nagad'} payment was completed automatically and the payout split was sent instantly.`);
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
        req.flash('error', 'Only confirmed transport tickets can be released.');
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
    guide_id, guide_name, start_date, days, total_price, return_to, payment_method, co_travelers, coupon_code
  } = req.body;
  const returnTo = safeReturnTo(return_to);
  const paymentMethod = normalizePaymentMethod(payment_method || 'wallet');
  const coTravelersJson = normalizeCoTravelers(co_travelers, 1);
  const amount = Number(total_price || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    req.flash('error', 'Invalid booking amount.');
    return res.redirect('/guides');
  }
  if (!paymentMethod) {
    req.flash('error', 'Please select a valid payment method.');
    return res.redirect('/guides');
  }
  const gatewayRef = paymentMethod === 'wallet' ? null : buildGatewayRef(paymentMethod);

  withTransaction((finish) => {
    resolveBookingCoupon(req.session.user.id, coupon_code, amount, (couponErr, pricing) => {
      if (couponErr) return finish(couponErr);
      getProviderUserId('guide', guide_id, (ownerErr, ownerId) => {
        if (ownerErr) return finish(ownerErr);
        const { amount: finalAmount, userFee, totalCharge, discount, coupon, couponCode } = pricing;
        const finalizeBooking = () => {
        db.run(
          "INSERT INTO bookings (user_id, type, item_id, item_name, check_in, persons, total_price, status, payment_method, payment_status, payment_fee, payment_gateway_ref, co_travelers, coupon_code, coupon_discount, escrow_status, paid_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'paid_out',CURRENT_TIMESTAMP)",
          [req.session.user.id, 'guide', guide_id, guide_name, start_date, days, finalAmount, 'confirmed', paymentMethod, 'paid', userFee, gatewayRef, coTravelersJson, couponCode, discount],
          function (insertErr) {
            if (insertErr) return finish(insertErr);
            const bookingId = this.lastID;
            const commissionRate = commissionRateFor('guide');
            settleBookingFunds(bookingId, req.session.user.id, ownerId, finalAmount, userFee, commissionRate, (settlementErr) => {
              if (settlementErr) return finish(settlementErr);
              if (paymentMethod === 'wallet') {
                recordWalletTx(req.session.user.id, -totalCharge, 'booking_debit', 'booking', bookingId, 'Guide booking');
              }
              return markCouponUsed(coupon?.id, bookingId, finish);
            });
          }
        );
        };

        if (paymentMethod !== 'wallet') return finalizeBooking();

        db.get("SELECT wallet_balance FROM users WHERE id=?", [req.session.user.id], (walletErr, me) => {
          if (walletErr || !me) return finish(walletErr || new Error('WALLET_NOT_FOUND'));
          if ((me.wallet_balance || 0) < totalCharge) return finish(new Error('INSUFFICIENT_BALANCE'));

          db.run(
            "UPDATE users SET wallet_balance = wallet_balance - ? WHERE id=? AND wallet_balance >= ?",
            [totalCharge, req.session.user.id, totalCharge],
            function (debitErr) {
              if (debitErr || this.changes === 0) return finish(debitErr || new Error('WALLET_DEBIT_FAILED'));
              return finalizeBooking();
            }
          );
        });
      });
    });
  }, (txErr) => {
    if (txErr) {
      if (txErr.message === 'INSUFFICIENT_BALANCE') {
        req.flash('error', 'Not enough wallet balance. Please top up your wallet.');
      } else if (txErr.message === 'INVALID_COUPON') {
        req.flash('error', 'Coupon code is invalid, expired, or already used.');
      } else if (txErr.message === 'COUPON_MIN_ORDER') {
        req.flash('error', 'This coupon requires a higher booking amount.');
      } else {
        req.flash('error', 'Could not complete guide booking. Please try again.');
      }
      return res.redirect('/guides');
    }
    req.flash('success', paymentMethod === 'wallet'
      ? 'Guide hired and confirmed successfully using your wallet! Partner payout and admin commission were sent instantly.'
      : `Guide hired and confirmed successfully! ${paymentMethod === 'bkash' ? 'bKash' : 'Nagad'} payment was completed automatically and the payout split was sent instantly.`);
    return res.redirect(returnTo || '/dashboard');
  });
});

// Book Package
router.post('/book/package', isAuth, (req, res) => {
  const {
    pkg_id, pkg_name, travel_date, persons, total_price, payment_method, co_travelers, coupon_code
  } = req.body;
  const paymentMethod = normalizePaymentMethod(payment_method || 'wallet');
  const personCount = Math.max(1, parseInt(persons, 10) || 1);
  const coTravelersJson = normalizeCoTravelers(co_travelers, personCount);
  const amount = Number(total_price || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    req.flash('error', 'Invalid booking amount.');
    return res.redirect('/packages');
  }
  if (!paymentMethod) {
    req.flash('error', 'Please select a valid payment method.');
    return res.redirect('/packages');
  }
  const gatewayRef = paymentMethod === 'wallet' ? null : buildGatewayRef(paymentMethod);

  withTransaction((finish) => {
    resolveBookingCoupon(req.session.user.id, coupon_code, amount, (couponErr, pricing) => {
      if (couponErr) return finish(couponErr);
      getProviderUserId('package', pkg_id, (ownerErr, ownerId) => {
        if (ownerErr) return finish(ownerErr);
        const { amount: finalAmount, userFee, totalCharge, discount, coupon, couponCode } = pricing;
        const finalizeBooking = () => {
        db.run(
          "INSERT INTO bookings (user_id, type, item_id, item_name, check_in, persons, total_price, status, payment_method, payment_status, payment_fee, payment_gateway_ref, co_travelers, coupon_code, coupon_discount, escrow_status, paid_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'paid_out',CURRENT_TIMESTAMP)",
          [req.session.user.id, 'package', pkg_id, pkg_name, travel_date, personCount, finalAmount, 'confirmed', paymentMethod, 'paid', userFee, gatewayRef, coTravelersJson, couponCode, discount],
          function (insertErr) {
            if (insertErr) return finish(insertErr);
            const bookingId = this.lastID;
            const commissionRate = commissionRateFor('package');
            settleBookingFunds(bookingId, req.session.user.id, ownerId, finalAmount, userFee, commissionRate, (settlementErr) => {
              if (settlementErr) return finish(settlementErr);
              if (paymentMethod === 'wallet') {
                recordWalletTx(req.session.user.id, -totalCharge, 'booking_debit', 'booking', bookingId, 'Package booking');
              }
              return markCouponUsed(coupon?.id, bookingId, finish);
            });
          }
        );
        };

        if (paymentMethod !== 'wallet') return finalizeBooking();

        db.get("SELECT wallet_balance FROM users WHERE id=?", [req.session.user.id], (walletErr, me) => {
          if (walletErr || !me) return finish(walletErr || new Error('WALLET_NOT_FOUND'));
          if ((me.wallet_balance || 0) < totalCharge) return finish(new Error('INSUFFICIENT_BALANCE'));

          db.run(
            "UPDATE users SET wallet_balance = wallet_balance - ? WHERE id=? AND wallet_balance >= ?",
            [totalCharge, req.session.user.id, totalCharge],
            function (debitErr) {
              if (debitErr || this.changes === 0) return finish(debitErr || new Error('WALLET_DEBIT_FAILED'));
              return finalizeBooking();
            }
          );
        });
      });
    });
  }, (txErr) => {
    if (txErr) {
      if (txErr.message === 'INSUFFICIENT_BALANCE') {
        req.flash('error', 'Not enough wallet balance. Please top up your wallet.');
      } else if (txErr.message === 'INVALID_COUPON') {
        req.flash('error', 'Coupon code is invalid, expired, or already used.');
      } else if (txErr.message === 'COUPON_MIN_ORDER') {
        req.flash('error', 'This coupon requires a higher booking amount.');
      } else {
        req.flash('error', 'Could not complete package booking. Please try again.');
      }
      return res.redirect('/packages');
    }
    req.flash('success', paymentMethod === 'wallet'
      ? 'Package booked and confirmed successfully using your wallet! Partner payout and admin commission were sent instantly.'
      : `Package booked and confirmed successfully! ${paymentMethod === 'bkash' ? 'bKash' : 'Nagad'} payment was completed automatically and the payout split was sent instantly.`);
    return res.redirect('/dashboard');
  });
});

router.get('/bookings/:id/ticket', isAuth, (req, res) => {
  const bookingId = parseInt(req.params.id, 10);
  if (!Number.isInteger(bookingId) || bookingId <= 0) return res.redirect('/dashboard');

  db.get(
    `SELECT b.*, u.name as user_name, u.email as user_email, u.phone as user_phone
     FROM bookings b
     JOIN users u ON u.id = b.user_id
     WHERE b.id=? AND b.user_id=?`,
    [bookingId, req.session.user.id],
    (err, booking) => {
      if (err || !booking) {
        req.flash('error', 'Ticket not found.');
        return res.redirect('/dashboard');
      }
      const ticketData = {
        ...booking,
        ticket_number: buildTicketNumber(booking),
        coTravelers: parseCoTravelers(booking.co_travelers),
        paymentInfo: getServicePaymentInfo(booking.type, booking.payment_method, booking.item_name)
      };
      if (String(req.query.download || '') === '1') {
        res.setHeader('Content-Disposition', `attachment; filename="ticket-${ticketData.ticket_number}.html"`);
      }
      return res.render('user/ticket', {
        title: `${ticketData.ticket_number} Ticket`,
        ticket: ticketData,
        user: req.session.user
      });
    }
  );
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
            e.id as escrow_id, e.status as escrow_status, e.amount as escrow_amount,
            e.provider_user_id, e.user_fee_amount, e.provider_commission_amount
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

      withTransaction((finish) => {
        db.run("UPDATE bookings SET status='cancelled' WHERE id=? AND user_id=?", [booking.id, req.session.user.id], (updErr) => {
          if (updErr) return finish(updErr);
          if (booking.escrow_id) {
            refundBookingSettlement(
              booking.id,
              req.session.user.id,
              refundAmount,
              refundFee,
              {
                id: booking.escrow_id,
                status: booking.escrow_status,
                amount: booking.escrow_amount,
                provider_user_id: booking.provider_user_id,
                user_fee_amount: booking.user_fee_amount,
                provider_commission_amount: booking.provider_commission_amount
              },
              'Booking refund',
              (refundErr) => {
                if (refundErr && refundErr.message === 'REFUND_PENDING_INSUFFICIENT_FUNDS') {
                  return db.run(
                    "UPDATE bookings SET escrow_status='refund_pending', payment_status='refund_pending' WHERE id=? AND user_id=?",
                    [booking.id, req.session.user.id],
                    (bookPendingErr) => {
                      if (bookPendingErr) return finish(bookPendingErr);
                      db.run("UPDATE escrow_payments SET status='refund_pending' WHERE id=?", [booking.escrow_id], (escrowPendingErr) => finish(escrowPendingErr || null));
                    }
                  );
                }
                if (refundErr) return finish(refundErr);
                db.run(
                  "UPDATE bookings SET escrow_status='refunded', payment_status='refunded' WHERE id=? AND user_id=?",
                  [booking.id, req.session.user.id],
                  (bookRefundErr) => {
                    if (bookRefundErr) return finish(bookRefundErr);
                    db.run("UPDATE escrow_payments SET status='refunded', released_at=CURRENT_TIMESTAMP WHERE id=?", [booking.escrow_id], (escrowErr) => finish(escrowErr || null));
                  }
                );
              }
            );
          } else {
            return finish(null);
          }
        });
      }, (txErr) => {
        if (txErr) {
          req.flash('error', 'Could not cancel booking. Please try again.');
          return res.redirect('/dashboard');
        }
        if (booking.escrow_id && String(booking.escrow_status || '').toLowerCase() !== 'refunded') {
          db.get("SELECT status FROM escrow_payments WHERE id=?", [booking.escrow_id], (statusErr, row) => {
            if (!statusErr && String(row?.status || '').toLowerCase() === 'refund_pending') {
              req.flash('success', 'Booking cancelled. Refund is marked pending because partner/admin wallet balance is currently low.');
              return res.redirect('/dashboard');
            }
            req.flash('success', 'Booking cancelled and refund processed successfully.');
            return res.redirect('/dashboard');
          });
          return;
        }
        req.flash('success', 'Booking cancelled and refund processed successfully.');
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
