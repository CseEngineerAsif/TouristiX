# 🇧🇩 TouristiX - Bangladesh Tourism Website

A full-stack tourism website for Bangladesh built with Node.js, Express, EJS, and SQLite.

## 🚀 Quick Start (VS Code)

### Prerequisites
- [Node.js](https://nodejs.org) v16 or higher
- VS Code (recommended)

### Installation

1. **Open this folder in VS Code**
2. **Open Terminal** (`Ctrl + `` ` ``)
3. **Install dependencies:**
   ```bash
   npm install
   ```
4. **Start the server:**
   ```bash
   npm start
   ```
5. **Open browser:** http://localhost:3000

That's it! The database is created automatically on first run.

---

## 🔐 Login Credentials

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@touristix.com | admin123 |
| User | Register at /auth/register | Your choice |

**Admin Panel:** http://localhost:3000/admin/dashboard

---

## ✅ Features

### User Side
- 🗺️ Browse all tourist spots with search & filter
- 📍 Filter by division, category, district
- 🌤️ Live weather information on spot pages
- 🏨 Hotel booking with date & person selector
- 🚌 Transport booking (Bus, Train, Air, Launch)
- 👨‍🦯 Expert guide hiring
- 📦 Travel packages with all-inclusive options
- ❤️ Favorite/save spots
- ⭐ Reviews and star ratings
- 📋 Personal booking dashboard

### Admin Side
- 📊 Dashboard analytics (users, bookings, spots stats)
- 👥 Manage users (view, delete)
- 📅 Manage bookings (confirm, cancel)
- 🗺️ Add/Edit/Delete tourist spots with image upload
- 🏨 Add/Delete hotels
- 🖼️ Media library for image uploads
- 📋 Recent bookings overview

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js + Express.js |
| Database | SQLite (via sqlite3) |
| Views | EJS (Embedded JS Templates) |
| Auth | express-session + bcryptjs |
| File Upload | Multer |
| CSS | Custom CSS (no frameworks) |
| Icons | Font Awesome 6 |

---

## 📁 Project Structure

```
TouristiX/
├── server.js              # Entry point
├── package.json
├── .env                   # Environment variables
├── database.sqlite        # Auto-created on first run
├── config/
│   └── database.js        # DB setup & seed data
├── middleware/
│   └── auth.js            # Auth middleware
├── routes/
│   ├── user.js            # User routes
│   ├── auth.js            # Login/Register routes
│   └── admin.js           # Admin routes
├── views/
│   ├── partials/          # Header, Footer
│   ├── auth/              # Login, Register
│   ├── user/              # All user pages
│   └── admin/             # All admin pages
└── public/
    ├── css/               # Stylesheets
    ├── js/                # JavaScript
    ├── images/            # Static images
    └── uploads/           # Uploaded images
```

---

## 🔧 Development

```bash
# Install nodemon for auto-reload
npm install -D nodemon

# Run in development mode
npm run dev
```

---

## 📝 Notes

- Database file (`database.sqlite`) is auto-created with seed data on first run
- Uploaded images go to `public/uploads/`
- Session data is stored in memory (restart clears sessions)
- For production, consider PostgreSQL and Redis for sessions
