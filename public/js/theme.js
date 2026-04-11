/* eslint-disable no-undef, no-unused-vars, no-empty, no-redeclare, no-prototype-builtins -- classic script shares globals across public/js/*.js, see week-3 modularization */
// === THEME TOGGLE ===
function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const newTheme = isDark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', newTheme === 'dark' ? 'dark' : '');
  if (newTheme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  document.getElementById('themeBtn').textContent = newTheme === 'dark' ? '🌙' : '☀️';
  document.getElementById('metaThemeColor').content = newTheme === 'dark' ? '#1a1a2e' : '#f5f6fa';
  try { localStorage.setItem('fa-theme', newTheme); } catch {}
}

function loadTheme() {
  let saved = null;
  try { saved = localStorage.getItem('fa-theme'); } catch {}
  const theme = saved || 'light'; // default light
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.getElementById('themeBtn').textContent = '🌙';
    document.getElementById('metaThemeColor').content = '#1a1a2e';
  }
}

