/* eslint-disable no-undef, no-unused-vars -- classic script shares globals across public/js/*.js */
// === NOTIFICATIONS (varsler fra cron-jobber) ===
async function checkNotifications() {
  try {
    const data = await api('/api/notifications');
    if (data.notifications && data.notifications.length > 0) {
      const latest = data.notifications[data.notifications.length - 1];
      if (latest.type === 'shelf_life' && latest.warnings) {
        // Uke 4 (FE-8): bruk showConfirm, ikke native confirm()
        const msgs = latest.warnings.map((w) => w.message).join('\n\n');
        const ok = await showConfirm({
          title: '⚠️ Holdbarhetsvarsler',
          message: msgs,
          confirmLabel: 'Marker som lest',
          cancelLabel: 'Senere',
        });
        if (ok) {
          await api('/api/notifications/read', { method: 'PUT' });
        }
      }
    }
  } catch {
    /* stille feil */
  }
}

