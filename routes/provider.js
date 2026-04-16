const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const { isProvider, isProviderGuest } = require('../middleware/auth');

const router = express.Router();

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

function recordWalletTx(userId, amount, type, refType, refId, note, cb) {
  db.run(
    "INSERT INTO wallet_transactions (user_id, amount, type, ref_type, ref_id, note) VALUES (?,?,?,?,?,?)",
    [userId, amount, type, refType || null, refId || null, note || ''],
    cb || (() => {})
  );
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

function getAdminUserId(cb) {
  db.get("SELECT id FROM users WHERE role='admin' ORDER BY id ASC LIMIT 1", (err, row) => {
    if (err || !row) return cb(null);
    return cb(row.id);
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

function parseCoTravelers(rawValue) {
  try {
    const parsed = JSON.parse(String(rawValue || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
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
    const enrichedBookings = (bookings || []).map((booking) => ({
      ...booking,
      traveler_preview: {
        customer_name: booking.user_name || 'Unknown',
        customer_email: booking.user_email || '',
        customer_phone: booking.user_phone || '',
        co_travelers: parseCoTravelers(booking.co_travelers)
      }
    }));

    res.render('provider/dashboard', {
      title: 'Partner Dashboard',
      providerType,
      items: items || [],
      bookings: enrichedBookings,
      user: req.session.user
    });
  };

  if (providerType === 'hotel') {
    db.all("SELECT * FROM hotels WHERE owner_user_id=? ORDER BY id DESC", [uid], (err, hotels) => {
      db.all(
        `SELECT b.*, u.name as user_name, u.email as user_email, u.phone as user_phone,
                e.status as escrow_status, e.provider_commission_amount, e.provider_commission_rate
         FROM bookings b
         JOIN hotels h ON h.id = b.item_id
         LEFT JOIN users u ON u.id = b.user_id
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
        `SELECT b.*, u.name as user_name, u.email as user_email, u.phone as user_phone,
                e.status as escrow_status, e.provider_commission_amount, e.provider_commission_rate
         FROM bookings b
         JOIN transport t ON t.id = b.item_id
         LEFT JOIN users u ON u.id = b.user_id
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
        `SELECT b.*, u.name as user_name, u.email as user_email, u.phone as user_phone,
                e.status as escrow_status, e.provider_commission_amount, e.provider_commission_rate
         FROM bookings b
         JOIN guides g ON g.id = b.item_id
         LEFT JOIN users u ON u.id = b.user_id
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
      `SELECT b.*, u.name as user_name, u.email as user_email, u.phone as user_phone,
              e.status as escrow_status, e.provider_commission_amount, e.provider_commission_rate
       FROM bookings b
       JOIN packages p ON p.id = b.item_id
       LEFT JOIN users u ON u.id = b.user_id
       LEFT JOIN escrow_payments e ON e.booking_id = b.id
       WHERE b.type='package' AND p.owner_user_id=?
       ORDER BY b.created_at DESC`,
      [uid],
      (err2, bookings) => renderDashboard(packages, bookings)
    );
  });
});

router.post('/bookings/:id/status', isProvider, (req, res) => {
  const bookingId = req.params.id;
  const uid = req.session.user.id;
  const providerType = typeFromRole(req.session.user.role);
  const nextStatus = String(req.body.status || '').toLowerCase();

  if (!['pending', 'confirmed', 'completed', 'cancelled'].includes(nextStatus)) {
    req.flash('error', 'Invalid booking status.');
    return res.redirect('/partner/dashboard');
  }

  let joinTable = 'hotels';
  if (providerType === 'transport') joinTable = 'transport';
  if (providerType === 'guide') joinTable = 'guides';
  if (providerType === 'package') joinTable = 'packages';

  db.get(
    `SELECT b.id, b.user_id, b.status, b.exchange_locked, b.payment_fee, b.total_price,
            e.id as escrow_id, e.status as escrow_payment_status, e.amount as escrow_amount,
            e.provider_user_id, e.user_fee_amount, e.provider_commission_amount
     FROM bookings b
     JOIN ${joinTable} x ON x.id = b.item_id
     LEFT JOIN escrow_payments e ON e.booking_id = b.id
     WHERE b.id = ? AND b.type = ? AND x.owner_user_id = ?`,
    [bookingId, providerType, uid],
    (err, booking) => {
      if (err || !booking) {
        req.flash('error', 'Booking not found for your account.');
        return res.redirect('/partner/dashboard');
      }

      if (booking.status === 'cancelled' || booking.status === 'completed') {
        req.flash('error', `${booking.status.charAt(0).toUpperCase() + booking.status.slice(1)} bookings cannot be changed.`);
        return res.redirect('/partner/dashboard');
      }

      if (providerType === 'transport' && booking.exchange_locked && nextStatus === 'cancelled') {
        req.flash('error', 'This exchanged ticket cannot be cancelled.');
        return res.redirect('/partner/dashboard');
      }

      if (booking.status === nextStatus) {
        req.flash('success', `Booking already ${nextStatus}.`);
        return res.redirect('/partner/dashboard');
      }

      if (nextStatus !== 'cancelled') {
        db.run("UPDATE bookings SET status=? WHERE id=?", [nextStatus, bookingId], (updateErr) => {
          if (updateErr) {
            req.flash('error', 'Could not update booking status.');
            return res.redirect('/partner/dashboard');
          }
          req.flash('success', `Booking ${nextStatus} successfully.`);
          return res.redirect('/partner/dashboard');
        });
        return;
      }

      const refundAmount = Number(booking.escrow_amount || booking.total_price || 0);
      const refundFee = Number(booking.payment_fee || 0);

      withTransaction((finish) => {
        db.run(
          "UPDATE bookings SET status='cancelled' WHERE id=?",
          [bookingId],
          (updateErr) => {
            if (updateErr) return finish(updateErr);

            if (booking.escrow_id) {
              refundBookingSettlement(
                bookingId,
                booking.user_id,
                refundAmount,
                refundFee,
                {
                  id: booking.escrow_id,
                  status: booking.escrow_payment_status,
                  amount: booking.escrow_amount,
                  provider_user_id: booking.provider_user_id,
                  user_fee_amount: booking.user_fee_amount,
                  provider_commission_amount: booking.provider_commission_amount
                },
                'Provider cancelled booking refund',
                (refundErr) => {
                  if (refundErr && refundErr.message === 'REFUND_PENDING_INSUFFICIENT_FUNDS') {
                    return db.run(
                      "UPDATE bookings SET escrow_status='refund_pending', payment_status='refund_pending' WHERE id=?",
                      [bookingId],
                      (bookPendingErr) => {
                        if (bookPendingErr) return finish(bookPendingErr);
                        db.run("UPDATE escrow_payments SET status='refund_pending' WHERE id=?", [booking.escrow_id], (escrowPendingErr) => finish(escrowPendingErr || null));
                      }
                    );
                  }
                  if (refundErr) return finish(refundErr);
                  db.run(
                    "UPDATE bookings SET escrow_status='refunded', payment_status='refunded' WHERE id=?",
                    [bookingId],
                    (bookRefundErr) => {
                      if (bookRefundErr) return finish(bookRefundErr);
                      db.run(
                        "UPDATE escrow_payments SET status='refunded', released_at=CURRENT_TIMESTAMP WHERE id=?",
                        [booking.escrow_id],
                        (escrowErr) => finish(escrowErr || null)
                      );
                    }
                  );
                }
              );
            } else {
              finish(null);
            }
          }
        );
      }, (txErr) => {
        if (txErr) {
          req.flash('error', 'Could not cancel booking.');
          return res.redirect('/partner/dashboard');
        }
        if (booking.escrow_id) {
          db.get("SELECT status FROM escrow_payments WHERE id=?", [booking.escrow_id], (statusErr, row) => {
            if (!statusErr && String(row?.status || '').toLowerCase() === 'refund_pending') {
              req.flash('success', 'Booking cancelled. Refund is marked pending because partner/admin wallet balance is currently low.');
              return res.redirect('/partner/dashboard');
            }
            req.flash('success', 'Booking cancelled and refund processed successfully.');
            return res.redirect('/partner/dashboard');
          });
          return;
        }
        req.flash('success', 'Booking cancelled and refund processed successfully.');
        return res.redirect('/partner/dashboard');
      });
    }
  );
});

router.get('/logout', isProvider, (req, res) => {
  req.session.destroy();
  res.redirect('/auth/login?tab=partner');
});

module.exports = router;
