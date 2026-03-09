// Shared frontend utilities for TravelBattle

const TravelBattle = {
  // ── Auth helpers ──────────────────────────────────────────────────────
  getUser() {
    return localStorage.getItem('tb_user');
  },
  getToken() {
    return localStorage.getItem('tb_token');
  },
  isLoggedIn() {
    return !!(this.getUser() && this.getToken());
  },
  logout() {
    localStorage.removeItem('tb_user');
    localStorage.removeItem('tb_token');
    window.location.href = '/login';
  },

  // ── Settings ──────────────────────────────────────────────────────────
  getOrigin() {
    return localStorage.getItem('tb_origin') || 'LHR';
  },
  getBudget() {
    const v = localStorage.getItem('tb_budget');
    return v ? parseFloat(v) : null;
  },

  // ── Date util ─────────────────────────────────────────────────────────
  getTravelDate(daysFromNow = 30) {
    const d = new Date();
    d.setDate(d.getDate() + daysFromNow);
    return d.toISOString().split('T')[0];
  },

  // ── Airport search ────────────────────────────────────────────────────
  async searchAirports(query) {
    if (!query || query.length < 2) return [];
    try {
      const res = await fetch(`/api/airports?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      return data.results || [];
    } catch {
      return [];
    }
  },

  // ── Leaderboard fetch ─────────────────────────────────────────────────
  async getLeaderboard() {
    try {
      const res = await fetch('/api/leaderboard');
      const data = await res.json();
      return data.leaderboard || [];
    } catch {
      return [];
    }
  }
};

window.TravelBattle = TravelBattle;
