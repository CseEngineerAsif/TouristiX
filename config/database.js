const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const db = new sqlite3.Database(path.join(__dirname, '../database.sqlite'), (err) => {
  if (err) console.error('DB Error:', err);
  else console.log('✅ Database connected');
});

db.serialize(() => {
  const PARTNER_DEFAULT_PASSWORD = 'partner123';

  function slugifyPartnerValue(value, fallback) {
    const normalized = String(value || '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '.')
      .replace(/^\.|\.$/g, '');
    return normalized || fallback;
  }

  function buildPartnerSeed(tableName, row) {
    const label =
      tableName === 'transport' ? (row.company || row.type || 'Transport') :
      (row.name || row.company || row.type || 'Partner');
    const slugSource =
      tableName === 'transport'
        ? (row.company || row.type)
        : (row.name || row.company || row.type);

    return {
      label,
      email: `${slugifyPartnerValue(slugSource, `${tableName}.${row.id}`)}@partner.local`
    };
  }

  function ensurePartnerForItems(tableName, role) {
    const lookupQuery =
      tableName === 'transport'
        ? "SELECT id, owner_user_id, '' as name, company, type FROM transport ORDER BY id ASC"
        : `SELECT id, owner_user_id, name, '' as company, '' as type FROM ${tableName} ORDER BY id ASC`;

    db.all(lookupQuery, (err, rows) => {
      if (err || !rows || rows.length === 0) return;
      rows.forEach((row) => {
        if (row.owner_user_id) return;
        const seed = buildPartnerSeed(tableName, row);
        db.get("SELECT id FROM users WHERE email=?", [seed.email], (uErr, existing) => {
          if (uErr) return;
          const finalizeAssign = (userId) => {
            db.run(`UPDATE ${tableName} SET owner_user_id=? WHERE id=?`, [userId, row.id]);
          };
          if (existing && existing.id) return finalizeAssign(existing.id);
          const hash = bcrypt.hashSync(PARTNER_DEFAULT_PASSWORD, 10);
          db.run(
            "INSERT INTO users (name, email, password, role) VALUES (?,?,?,?)",
            [seed.label, seed.email, hash, role],
            function () {
              if (this.lastID) finalizeAssign(this.lastID);
            }
          );
        });
      });
    });
  }
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    id_type TEXT,
    id_document TEXT,
    role TEXT DEFAULT 'user',
    avatar TEXT DEFAULT '',
    wallet_balance INTEGER DEFAULT 20000,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.all(`PRAGMA table_info(users)`, (err, cols) => {
    if (err || !Array.isArray(cols)) return;
    const colNames = cols.map(c => c.name);
    if (!colNames.includes('gender')) {
      db.run("ALTER TABLE users ADD COLUMN gender TEXT");
    }
    if (!colNames.includes('wallet_balance')) {
      db.run("ALTER TABLE users ADD COLUMN wallet_balance INTEGER DEFAULT 20000");
    }
    if (!colNames.includes('address')) {
      db.run("ALTER TABLE users ADD COLUMN address TEXT");
    }
    if (!colNames.includes('id_type')) {
      db.run("ALTER TABLE users ADD COLUMN id_type TEXT");
    }
    if (!colNames.includes('id_document')) {
      db.run("ALTER TABLE users ADD COLUMN id_document TEXT");
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS tourist_spots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    district TEXT NOT NULL,
    division TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    image TEXT DEFAULT '',
    rating REAL DEFAULT 0,
    total_reviews INTEGER DEFAULT 0,
    entry_fee INTEGER DEFAULT 0,
    best_time TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS hotels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    location TEXT NOT NULL,
    district TEXT NOT NULL,
    price_per_night INTEGER NOT NULL,
    rating REAL DEFAULT 0,
    image TEXT DEFAULT '',
    facilities TEXT,
    description TEXT,
    total_rooms INTEGER DEFAULT 10,
    available_rooms INTEGER DEFAULT 10,
    owner_user_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS guides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    specialty TEXT,
    languages TEXT,
    experience TEXT,
    rating REAL DEFAULT 0,
    price_per_day INTEGER DEFAULT 1000,
    image TEXT DEFAULT '',
    bio TEXT,
    phone TEXT,
    available INTEGER DEFAULT 1,
    owner_user_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS transport (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    company TEXT,
    from_location TEXT NOT NULL,
    to_location TEXT NOT NULL,
    departure_time TEXT,
    price INTEGER NOT NULL,
    seats_available INTEGER DEFAULT 40,
    image TEXT DEFAULT '',
    owner_user_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.all(`PRAGMA table_info(hotels)`, (err, cols) => {
    if (err || !Array.isArray(cols)) return;
    const colNames = cols.map(c => c.name);
    if (!colNames.includes('owner_user_id')) {
      db.run("ALTER TABLE hotels ADD COLUMN owner_user_id INTEGER");
    }
  });

  db.all(`PRAGMA table_info(guides)`, (err, cols) => {
    if (err || !Array.isArray(cols)) return;
    const colNames = cols.map(c => c.name);
    if (!colNames.includes('owner_user_id')) {
      db.run("ALTER TABLE guides ADD COLUMN owner_user_id INTEGER");
    }
  });

  db.all(`PRAGMA table_info(transport)`, (err, cols) => {
    if (err || !Array.isArray(cols)) return;
    const colNames = cols.map(c => c.name);
    if (!colNames.includes('owner_user_id')) {
      db.run("ALTER TABLE transport ADD COLUMN owner_user_id INTEGER");
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS packages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    destination TEXT NOT NULL,
    duration TEXT,
    price INTEGER NOT NULL,
    includes TEXT,
    image TEXT DEFAULT '',
    description TEXT,
    max_persons INTEGER DEFAULT 20,
    owner_user_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    item_id INTEGER NOT NULL,
    item_name TEXT,
    check_in TEXT,
    check_out TEXT,
    persons INTEGER DEFAULT 1,
    total_price INTEGER,
    status TEXT DEFAULT 'pending',
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.all(`PRAGMA table_info(bookings)`, (err, cols) => {
    if (err || !Array.isArray(cols)) return;
    const colNames = cols.map(c => c.name);
    if (!colNames.includes('seat_numbers')) {
      db.run("ALTER TABLE bookings ADD COLUMN seat_numbers TEXT");
    }
    if (!colNames.includes('exchange_locked')) {
      db.run("ALTER TABLE bookings ADD COLUMN exchange_locked INTEGER DEFAULT 0");
    }
    if (!colNames.includes('payment_method')) {
      db.run("ALTER TABLE bookings ADD COLUMN payment_method TEXT");
    }
    if (!colNames.includes('payment_status')) {
      db.run("ALTER TABLE bookings ADD COLUMN payment_status TEXT DEFAULT 'paid'");
    }
    if (!colNames.includes('payment_number')) {
      db.run("ALTER TABLE bookings ADD COLUMN payment_number TEXT");
    }
    if (!colNames.includes('payment_txn_id')) {
      db.run("ALTER TABLE bookings ADD COLUMN payment_txn_id TEXT");
    }
    if (!colNames.includes('payment_gateway_ref')) {
      db.run("ALTER TABLE bookings ADD COLUMN payment_gateway_ref TEXT");
    }
    if (!colNames.includes('co_travelers')) {
      db.run("ALTER TABLE bookings ADD COLUMN co_travelers TEXT");
    }
    if (!colNames.includes('paid_at')) {
      db.run("ALTER TABLE bookings ADD COLUMN paid_at DATETIME");
    }
    if (!colNames.includes('payment_fee')) {
      db.run("ALTER TABLE bookings ADD COLUMN payment_fee INTEGER DEFAULT 0");
    }
    if (!colNames.includes('escrow_status')) {
      db.run("ALTER TABLE bookings ADD COLUMN escrow_status TEXT DEFAULT 'none'");
    }
    if (!colNames.includes('coupon_code')) {
      db.run("ALTER TABLE bookings ADD COLUMN coupon_code TEXT");
    }
    if (!colNames.includes('coupon_discount')) {
      db.run("ALTER TABLE bookings ADD COLUMN coupon_discount INTEGER DEFAULT 0");
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS exchange_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id INTEGER NOT NULL,
    requester_id INTEGER NOT NULL,
    amount INTEGER DEFAULT 0,
    payment_status TEXT DEFAULT 'held',
    status TEXT DEFAULT 'pending',
    admin_id INTEGER,
    admin_note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    processed_at DATETIME,
    FOREIGN KEY(booking_id) REFERENCES bookings(id),
    FOREIGN KEY(requester_id) REFERENCES users(id),
    FOREIGN KEY(admin_id) REFERENCES users(id)
  )`);

  db.run("CREATE INDEX IF NOT EXISTS idx_exchange_requests_booking ON exchange_requests(booking_id, status, created_at)");
  db.run("CREATE INDEX IF NOT EXISTS idx_exchange_requests_requester ON exchange_requests(requester_id, status)");

  db.all(`PRAGMA table_info(exchange_requests)`, (err, cols) => {
    if (err || !Array.isArray(cols)) return;
    const colNames = cols.map(c => c.name);
    const ensureIndex = () => {
      db.run("CREATE INDEX IF NOT EXISTS idx_exchange_requests_payment ON exchange_requests(payment_status, status)");
    };
    if (!colNames.includes('amount')) {
      db.run("ALTER TABLE exchange_requests ADD COLUMN amount INTEGER DEFAULT 0", () => {
        if (!colNames.includes('payment_status')) {
          db.run("ALTER TABLE exchange_requests ADD COLUMN payment_status TEXT DEFAULT 'held'", ensureIndex);
        } else {
          ensureIndex();
        }
      });
      return;
    }
    if (!colNames.includes('payment_status')) {
      db.run("ALTER TABLE exchange_requests ADD COLUMN payment_status TEXT DEFAULT 'held'", ensureIndex);
      return;
    }
    ensureIndex();
  });

  db.run(`CREATE TABLE IF NOT EXISTS wallet_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    type TEXT NOT NULL,
    ref_type TEXT,
    ref_id INTEGER,
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
  db.run("CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user ON wallet_transactions(user_id, created_at)");

  db.run(`CREATE TABLE IF NOT EXISTS wallet_topups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    gateway TEXT NOT NULL,
    amount INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    gateway_ref TEXT,
    payment_number TEXT,
    payment_txn_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    paid_at DATETIME,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
  db.run("CREATE INDEX IF NOT EXISTS idx_wallet_topups_user ON wallet_topups(user_id, status, created_at)");
  db.all(`PRAGMA table_info(wallet_topups)`, (err, cols) => {
    if (err || !Array.isArray(cols)) return;
    const colNames = cols.map(c => c.name);
    if (!colNames.includes('payment_number')) {
      db.run("ALTER TABLE wallet_topups ADD COLUMN payment_number TEXT");
    }
    if (!colNames.includes('payment_txn_id')) {
      db.run("ALTER TABLE wallet_topups ADD COLUMN payment_txn_id TEXT");
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS escrow_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id INTEGER NOT NULL,
    payer_id INTEGER NOT NULL,
    provider_user_id INTEGER,
    amount INTEGER NOT NULL,
    user_fee_amount INTEGER DEFAULT 0,
    provider_commission_rate REAL DEFAULT 0,
    provider_commission_amount INTEGER DEFAULT 0,
    status TEXT DEFAULT 'held',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    released_at DATETIME,
    FOREIGN KEY(booking_id) REFERENCES bookings(id),
    FOREIGN KEY(payer_id) REFERENCES users(id),
    FOREIGN KEY(provider_user_id) REFERENCES users(id)
  )`);
  db.run("CREATE INDEX IF NOT EXISTS idx_escrow_status ON escrow_payments(status, created_at)");

  db.run(`CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    spot_id INTEGER NOT NULL,
    rating INTEGER NOT NULL,
    comment TEXT,
    photo TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(spot_id) REFERENCES tourist_spots(id)
  )`);

  db.all(`PRAGMA table_info(reviews)`, (err, cols) => {
    if (err || !Array.isArray(cols)) return;
    const colNames = cols.map(c => c.name);
    if (!colNames.includes('photo')) {
      db.run("ALTER TABLE reviews ADD COLUMN photo TEXT DEFAULT ''");
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    spot_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(spot_id) REFERENCES tourist_spots(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS guide_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    guide_id INTEGER NOT NULL,
    sender_role TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(guide_id) REFERENCES guides(id)
  )`);
  db.run("CREATE INDEX IF NOT EXISTS idx_guide_messages_thread ON guide_messages(user_id, guide_id, created_at)");

  db.run(`CREATE TABLE IF NOT EXISTS hotel_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    hotel_id INTEGER NOT NULL,
    sender_role TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(hotel_id) REFERENCES hotels(id)
  )`);
  db.run("CREATE INDEX IF NOT EXISTS idx_hotel_messages_thread ON hotel_messages(user_id, hotel_id, created_at)");

  db.run(`CREATE TABLE IF NOT EXISTS transport_seats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transport_id INTEGER NOT NULL,
    seat_no TEXT NOT NULL,
    is_booked INTEGER DEFAULT 0,
    booking_id INTEGER,
    booked_at DATETIME,
    FOREIGN KEY(transport_id) REFERENCES transport(id),
    FOREIGN KEY(booking_id) REFERENCES bookings(id)
  )`);
  db.run("CREATE INDEX IF NOT EXISTS idx_transport_seats_transport ON transport_seats(transport_id, is_booked)");

  db.run(`CREATE TABLE IF NOT EXISTS blog_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    media_urls TEXT,
    status TEXT DEFAULT 'pending',
    approved_at DATETIME,
    approved_by INTEGER,
    reward_coupon_id INTEGER,
    rejection_note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(approved_by) REFERENCES users(id)
  )`);
  db.run("CREATE INDEX IF NOT EXISTS idx_blog_posts_user ON blog_posts(user_id, created_at)");

  db.all(`PRAGMA table_info(blog_posts)`, (err, cols) => {
    if (err || !Array.isArray(cols)) return;
    const colNames = cols.map(c => c.name);
    const ensureBlogStatusIndex = () => {
      db.run("CREATE INDEX IF NOT EXISTS idx_blog_posts_status ON blog_posts(status, created_at)");
    };
    if (!colNames.includes('status')) {
      db.run("ALTER TABLE blog_posts ADD COLUMN status TEXT DEFAULT 'pending'", ensureBlogStatusIndex);
    } else {
      ensureBlogStatusIndex();
    }
    if (!colNames.includes('approved_at')) {
      db.run("ALTER TABLE blog_posts ADD COLUMN approved_at DATETIME");
    }
    if (!colNames.includes('approved_by')) {
      db.run("ALTER TABLE blog_posts ADD COLUMN approved_by INTEGER");
    }
    if (!colNames.includes('reward_coupon_id')) {
      db.run("ALTER TABLE blog_posts ADD COLUMN reward_coupon_id INTEGER");
    }
    if (!colNames.includes('rejection_note')) {
      db.run("ALTER TABLE blog_posts ADD COLUMN rejection_note TEXT");
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS coupons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    code TEXT NOT NULL UNIQUE,
    discount_type TEXT DEFAULT 'percent',
    discount_value INTEGER DEFAULT 10,
    max_discount INTEGER DEFAULT 500,
    min_order_amount INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    reward_source TEXT,
    reward_ref_id INTEGER,
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    used_at DATETIME,
    used_booking_id INTEGER,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(used_booking_id) REFERENCES bookings(id)
  )`);
  db.run("CREATE INDEX IF NOT EXISTS idx_coupons_user_status ON coupons(user_id, status, created_at)");
  db.run("CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code)");

  // Seed data
  db.get("SELECT COUNT(*) as cnt FROM tourist_spots", (err, row) => {
    if (row && row.cnt === 0) {
      const spots = [
        ["Cox's Bazar", "Cox's Bazar", "Chittagong", "Beach", "The world's longest natural sandy sea beach stretching 120km. Famous for sunrise, sunset and fresh seafood.", "https://images.unsplash.com/photo-1588667342642-03f1917f6946?w=800", 4.8, 1250, 0, "October to March"],
        ["Sajek Valley", "Rangamati", "Chittagong", "Hill", "The queen of hills where clouds dance below your feet. Breathtaking sunrise views and tribal culture.", "https://images.unsplash.com/photo-1623491554558-744046462002?w=800", 4.9, 980, 0, "September to February"],
        ["Sundarbans", "Bagerhat", "Khulna", "Forest", "World's largest mangrove forest, UNESCO World Heritage Site. Home of the Royal Bengal Tiger.", "https://images.unsplash.com/photo-1608933251783-a97950293d9b?w=800", 4.7, 870, 500, "October to March"],
        ["Bandarban", "Bandarban", "Chittagong", "Hill", "Home to the highest peaks of Bangladesh including Tahjindong and Keokradong. Rich tribal heritage.", "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800", 4.8, 720, 0, "October to April"],
        ["Sreemangal", "Moulvibazar", "Sylhet", "Garden", "The tea capital of Bangladesh. Famous for 7-color tea, lush green tea estates and wildlife.", "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800", 4.6, 550, 0, "Year round"],
        ["Rangamati", "Rangamati", "Chittagong", "Lake", "Beautiful lake district with hanging bridge, tribal culture, and stunning Kaptai Lake views.", "https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=800", 4.7, 630, 0, "October to March"],
        ["Mahasthangarh", "Bogra", "Rajshahi", "Heritage", "One of the earliest urban archaeological sites in Bangladesh, dating back 2500 years.", "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=800", 4.4, 320, 20, "Year round"],
        ["Paharpur", "Naogaon", "Rajshahi", "Heritage", "UNESCO World Heritage Site - ruins of the ancient Buddhist monastery Somapura Mahavihara.", "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800", 4.5, 290, 20, "Year round"],
        ["St. Martin's Island", "Cox's Bazar", "Chittagong", "Island", "The only coral island of Bangladesh with crystal clear water, colorful marine life.", "https://images.unsplash.com/photo-1559827260-dc66d52bef19?w=800", 4.9, 410, 0, "November to March"],
        ["Kuakata", "Patuakhali", "Barisal", "Beach", "The 'Daughter of the Sea' - one of the rare places in Bangladesh to see both sunrise and sunset.", "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800", 4.5, 380, 0, "October to March"],
        ["Bagerhat Mosque City", "Bagerhat", "Khulna", "Heritage", "Historic mosque city with 60-domed mosque, UNESCO World Heritage Site.", "https://images.unsplash.com/photo-1545469607-a4f7e1e8c2cc?w=800", 4.6, 340, 20, "Year round"],
        ["Ratargul Swamp Forest", "Sylhet", "Sylhet", "Forest", "Bangladesh's only freshwater swamp forest, submerged in water during monsoon.", "https://images.unsplash.com/photo-1448375240586-882707db888b?w=800", 4.7, 450, 100, "June to September"],
      ];
      const stmt = db.prepare("INSERT INTO tourist_spots (name, district, division, category, description, image, rating, total_reviews, entry_fee, best_time) VALUES (?,?,?,?,?,?,?,?,?,?)");
      spots.forEach(s => stmt.run(s));
      stmt.finalize();
    }
  });

  db.get("SELECT COUNT(*) as cnt FROM hotels", (err, row) => {
    if (row && row.cnt === 0) {
      const hotels = [
        ["Sajek Cloud Nest", "Sajek Valley", "Rangamati", 2500, 4.8, "https://images.unsplash.com/photo-1555854817-5b2260d37cbb?w=800", "Free Wi-Fi,Solar Power,Cloud View Deck,Restaurant", "Eco-friendly cottages above the clouds with stunning sunrise views.", 20, 15],
        ["Sea Breeze Luxury Inn", "Kolatoli Beach", "Cox's Bazar", 4800, 4.5, "https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=800", "Swimming Pool,AC,Ocean Front,Gym,Spa", "Steps from the world's longest beach with luxury amenities.", 50, 38],
        ["Sylhet Tea Resort", "Sreemangal", "Moulvibazar", 3200, 4.9, "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800", "Cycling Track,Tea Garden Walk,Restaurant,Wi-Fi", "Surrounded by emerald green tea gardens with the freshest air.", 30, 22],
        ["Hotel Cox Today", "Hotel Motel Zone", "Cox's Bazar", 3500, 4.3, "https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?w=800", "AC,Sea View,Restaurant,Parking", "Modern hotel with sea view rooms and excellent service.", 80, 55],
        ["Bandarban Hill Resort", "Bandarban Sadar", "Bandarban", 2800, 4.6, "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800", "Wi-Fi,Mountain View,Restaurant,Trekking Guide", "Nestled in hills with panoramic mountain views.", 25, 18],
        ["Kuakata Grand Hotel", "Kuakata Beach", "Patuakhali", 2200, 4.2, "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800", "Beach Front,Restaurant,AC,Parking", "Watch sunrise and sunset from the same beach.", 40, 30],
      ];
      const stmt = db.prepare("INSERT INTO hotels (name, location, district, price_per_night, rating, image, facilities, description, total_rooms, available_rooms) VALUES (?,?,?,?,?,?,?,?,?,?)");
      hotels.forEach(h => stmt.run(h));
      stmt.finalize();
    }
  });

  db.get("SELECT COUNT(*) as cnt FROM guides", (err, row) => {
    if (row && row.cnt === 0) {
      const guides = [
        ["Tanvir Ahmed", "Hill Tracts Explorer", "Bengali,English,Chakma", "8 Years", 4.9, 1500, "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400", "Expert in remote trekking routes of Bandarban and Rangamati. Certified wildlife guide.", "01711-123456"],
        ["Sumiya Akter", "Cultural Heritage", "Bengali,English,Hindi", "5 Years", 5.0, 1200, "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400", "Specializing in archeological sites of Bagerhat and Mahasthangarh with deep historical knowledge.", "01812-234567"],
        ["Zubayer Khan", "Mangrove Naturalist", "Bengali,English", "12 Years", 4.8, 2000, "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400", "Leading researcher on Royal Bengal Tiger habitats. Expert Sundarbans forest guide.", "01913-345678"],
        ["Rima Chakma", "Hill Tribes Culture", "Bengali,English,Chakma,Marma", "6 Years", 4.7, 1300, "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=400", "Born in the hill tracts, Rima offers authentic cultural immersion with local tribes.", "01614-456789"],
        ["Karim Hossain", "Coastal & Marine", "Bengali,English", "10 Years", 4.9, 1800, "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400", "Certified marine guide specializing in coral reef exploration at St. Martin's Island.", "01715-567890"],
      ];
      const stmt = db.prepare("INSERT INTO guides (name, specialty, languages, experience, rating, price_per_day, image, bio, phone) VALUES (?,?,?,?,?,?,?,?,?)");
      guides.forEach(g => stmt.run(g));
      stmt.finalize();
    }
  });

  db.get("SELECT COUNT(*) as cnt FROM transport", (err, row) => {
    if (row && row.cnt === 0) {
      const transports = [
        ["Bus", "Shyamoli Paribahan", "Dhaka", "Cox's Bazar", "10:00 PM", 800, 40],
        ["Bus", "Green Line", "Dhaka", "Cox's Bazar", "09:00 PM", 1200, 35],
        ["Train", "Sonar Bangla Express", "Dhaka", "Chittagong", "07:00 AM", 650, 60],
        ["Air", "Biman Bangladesh", "Dhaka", "Cox's Bazar", "08:30 AM", 4500, 120],
        ["Air", "US-Bangla Airlines", "Dhaka", "Cox's Bazar", "12:00 PM", 3800, 100],
        ["Bus", "Hanif Enterprise", "Dhaka", "Sylhet", "11:00 PM", 700, 45],
        ["Bus", "Shohagh Paribahan", "Dhaka", "Bandarban", "08:30 PM", 900, 40],
        ["Launch", "BIWTC", "Dhaka (Sadarghat)", "Barisal", "06:00 PM", 350, 200],
      ];
      const stmt = db.prepare("INSERT INTO transport (type, company, from_location, to_location, departure_time, price, seats_available) VALUES (?,?,?,?,?,?,?)");
      transports.forEach(t => stmt.run(t));
      stmt.finalize();
    }
  });

  db.get("SELECT COUNT(*) as cnt FROM packages", (err, row) => {
    if (row && row.cnt === 0) {
      const packages = [
        ["Cox's Bazar Beach Bliss", "Cox's Bazar", "3 Days 2 Nights", 6500, "Hotel,Transport,Breakfast,Guide", "https://images.unsplash.com/photo-1588667342642-03f1917f6946?w=800", "Enjoy the world's longest sea beach with guided tour, hotel stay and breakfast."],
        ["Sundarbans Tiger Trail", "Sundarbans", "4 Days 3 Nights", 12000, "Boat,Forest Lodge,All Meals,Expert Guide,Forest Entry", "https://images.unsplash.com/photo-1608933251783-a97950293d9b?w=800", "Deep forest expedition with an expert wildlife guide. Spot the Royal Bengal Tiger."],
        ["Sajek Cloud Adventure", "Sajek Valley", "3 Days 2 Nights", 8000, "Transport,Cottage,Breakfast,Tribal Guide", "https://images.unsplash.com/photo-1623491554558-744046462002?w=800", "Trek above the clouds in Sajek Valley with authentic tribal cultural experience."],
        ["Sylhet Tea Garden Tour", "Sreemangal", "2 Days 1 Night", 4500, "Resort,Transport,7-Color Tea,Garden Walk", "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800", "Relax in tea gardens, taste the famous 7-color tea and explore Lawachara forest."],
        ["Heritage Bangladesh", "Multiple", "5 Days 4 Nights", 15000, "Hotel,AC Bus,All Meals,Expert Guide,Entry Fees", "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=800", "Visit Paharpur, Mahasthangarh, Bagerhat Mosque - the best of Bangladesh's UNESCO sites."],
      ];
      const stmt = db.prepare("INSERT INTO packages (name, destination, duration, price, includes, image, description) VALUES (?,?,?,?,?,?,?)");
      packages.forEach(p => stmt.run(p));
      stmt.finalize();
    }
  });

  db.all(`PRAGMA table_info(packages)`, (err, cols) => {
    if (err || !Array.isArray(cols)) return;
    const colNames = cols.map(c => c.name);
    if (!colNames.includes('owner_user_id')) {
      db.run("ALTER TABLE packages ADD COLUMN owner_user_id INTEGER");
    }
  });

  db.get("SELECT COUNT(*) as cnt FROM users WHERE role='admin'", (err, row) => {
    if (row && row.cnt === 0) {
      const hash = bcrypt.hashSync('admin123', 10);
      db.run("INSERT INTO users (name, email, password, role) VALUES ('Admin', 'admin@touristix.com', ?, 'admin')", [hash]);
      console.log('✅ Admin created: admin@touristix.com / admin123');
    }
  });

  db.get("SELECT COUNT(*) as cnt FROM users WHERE email='partner@gmail.com'", (err, row) => {
    if (row && row.cnt === 0) {
      const hash = bcrypt.hashSync('partner', 10);
      db.run("INSERT INTO users (name, email, password, role) VALUES ('Default Partner', 'partner@gmail.com', ?, 'owner_hotel')", [hash]);
      console.log('✅ Partner created: partner@gmail.com / partner');
    }
  });

  ensurePartnerForItems('hotels', 'owner_hotel');
  ensurePartnerForItems('transport', 'owner_transport');
  ensurePartnerForItems('guides', 'owner_guide');
  ensurePartnerForItems('packages', 'owner_package');
});

module.exports = db;
