/* eslint-disable no-undef, no-unused-vars -- classic script shares globals across public/js/*.js */
// === NOTIFICATIONS (varsler fra cron-jobber + brukerhandlinger) ===
function parseNotificationData(n) {
  if (!n) return {};
  if (n.data_json && typeof n.data_json === 'string') {
    try {
      return JSON.parse(n.data_json) || {};
    } catch {
      return {};
    }
  }
  if (n.data_json && typeof n.data_json === 'object') return n.data_json;
  return {};
}

async function checkNotifications() {
  try {
    const data = await api('/api/notifications');
    if (!data.notifications || data.notifications.length === 0) return;
    const latest = data.notifications[data.notifications.length - 1];
    const parsed = parseNotificationData(latest);
    // Bakoverkompatibilitet: data-feltene kan være på latest direkte (gammelt)
    // eller i parsed (nytt/korrekt).
    const warnings = latest.warnings || parsed.warnings;
    const items = latest.items || parsed.items;

    if (latest.type === 'shelf_life' && warnings) {
      // Uke 4 (FE-8): bruk showConfirm, ikke native confirm()
      const msgs = warnings.map((w) => w.message).join('\n\n');
      const ok = await showConfirm({
        title: '⚠️ Holdbarhetsvarsler',
        message: msgs,
        confirmLabel: 'Marker som lest',
        cancelLabel: 'Senere',
      });
      if (ok) {
        await api('/api/notifications/read', { method: 'PUT' });
      }
      return;
    }

    if (latest.type === 'missing_ingredients') {
      const list = Array.isArray(items) ? items : [];
      const preview = list
        .slice(0, 10)
        .map((i) => `• ${i.name} (${i.qty} ${i.unit || ''})`)
        .join('\n');
      const msg =
        list.length === 0
          ? latest.message || 'Noen ingredienser mangler.'
          : preview + (list.length > 10 ? `\n… og ${list.length - 10} til` : '');
      const ok = await showConfirm({
        title: '🛒 Mangler for resten av uka',
        message: msg,
        confirmLabel: 'Se handleliste',
        cancelLabel: 'Senere',
      });
      if (ok) {
        await api('/api/notifications/read', { method: 'PUT' });
        const shoppingTab = document.querySelector('.tab[data-view="viewShopping"]');
        if (shoppingTab) shoppingTab.click();
      }
    }
  } catch {
    /* stille feil */
  }
}
