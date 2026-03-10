const isAuth = (req, res, next) => {
  if (req.session && req.session.user) return next();
  req.flash('error', 'Please login to continue.');
  res.redirect('/auth/login');
};

const isAdmin = (req, res, next) => {
  if (req.session && req.session.user && req.session.user.role === 'admin') return next();
  res.redirect('/');
};

const isGuest = (req, res, next) => {
  if (req.session && req.session.user) return res.redirect('/dashboard');
  next();
};

module.exports = { isAuth, isAdmin, isGuest };
