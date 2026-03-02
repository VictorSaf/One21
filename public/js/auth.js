// One21 Auth Module
const Auth = {
  getToken() {
    return localStorage.getItem('one21_token');
  },

  getUser() {
    try {
      return JSON.parse(localStorage.getItem('one21_user'));
    } catch { return null; }
  },

  logout() {
    localStorage.removeItem('one21_token');
    localStorage.removeItem('one21_user');
    const base = window.location.pathname.indexOf('/one21') !== -1 ? '/one21' : '';
    window.location.href = base + (base ? '/hey' : '/login.html');
  },

  requireAuth() {
    if (!this.getToken()) {
      const base = window.location.pathname.indexOf('/one21') !== -1 ? '/one21' : '';
      window.location.href = base + (base ? '/hey' : '/login.html');
      return false;
    }
    // Show admin button if user is admin
    const u = this.getUser();
    if (u && u.role === 'admin') {
      const btn = document.getElementById('adminNavBtn');
      if (btn) btn.style.display = '';
    }
    return true;
  },

  async api(url, options = {}) {
    const token = this.getToken();
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...(options.headers || {})
      }
    });
    if (res.status === 401) {
      this.logout(); // redirects to /one21/hey
      return null;
    }
    return res.json();
  }
};
