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
    window.location.href = '/login.html';
  },

  requireAuth() {
    if (!this.getToken()) {
      window.location.href = '/login.html';
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
      this.logout();
      return null;
    }
    return res.json();
  }
};
