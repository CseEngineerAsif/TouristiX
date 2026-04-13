const isAuth = (req, res, next) => {
  if (req.session && req.session.user) return next();
  req.flash('error', 'Please login to continue.');
  res.redirect('/auth/login');
};

const isAdmin = (req, res, next) => {
  if (req.session && req.session.user && req.session.user.role === 'admin') return next();
  res.redirect('/');
};

const isProvider = (req, res, next) => {
  const role = req.session?.user?.role;
  const allowed = role === 'owner_hotel' || role === 'owner_transport' || role === 'owner_guide' || role === 'owner_package';
  if (allowed) return next();
  req.flash('error', 'Please login as a service provider.');
  res.redirect('/partner/login');
};

const isGuest = (req, res, next) => {
  if (req.session && req.session.user) return res.redirect('/dashboard');
  next();
};

const isProviderGuest = (req, res, next) => {
  if (req.session && req.session.user) {
    const role = req.session.user.role;
    if (role === 'owner_hotel' || role === 'owner_transport' || role === 'owner_guide' || role === 'owner_package') {
      return res.redirect('/partner/dashboard');
    }
    return res.redirect('/');
  }
  next();
};

module.exports = { isAuth, isAdmin, isGuest, isProvider, isProviderGuest };
