// Auto-dismiss alerts
document.querySelectorAll('.alert').forEach(alert => {
  setTimeout(() => {
    alert.style.opacity = '0';
    alert.style.transition = 'opacity 0.5s';
    setTimeout(() => alert.remove(), 500);
  }, 4000);
});

// Close modals on backdrop click
document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('click', function(e) {
    if (e.target === this) this.style.display = 'none';
  });
});

// Close modals on Escape
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
  }
});

// Image lazy loading fallback
document.querySelectorAll('img[loading="lazy"]').forEach(img => {
  img.addEventListener('error', function() {
    this.src = '/images/placeholder.jpg';
  });
});

// Smooth active nav detection
const path = window.location.pathname;
document.querySelectorAll('.nav-links a').forEach(link => {
  if (link.getAttribute('href') === path) link.classList.add('active');
});

// Flash message from URL param
const params = new URLSearchParams(window.location.search);
if (params.get('success')) {
  const alert = document.createElement('div');
  alert.className = 'alert alert-success';
  alert.style.cssText = 'position:fixed;top:80px;right:20px;z-index:999;padding:14px 20px;border-radius:10px;font-weight:600';
  alert.textContent = decodeURIComponent(params.get('success'));
  document.body.appendChild(alert);
  setTimeout(() => alert.remove(), 4000);
}

console.log('🇧🇩 TouristiX loaded');
