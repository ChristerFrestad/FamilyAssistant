(function () {
  const WEEK = [
    { label: 'Mandag', meal: 'Gryte med rotgrønnsaker', items: [
      { name: 'Gulrot', qty: '400 g' },
      { name: 'Løk', qty: '2 stk' },
      { name: 'Fløte', qty: '2 dl', home: true },
    ] },
    { label: 'Tirsdag', meal: 'Lakseovn', items: [
      { name: 'Laks', qty: '600 g' },
      { name: 'Sitron', qty: '1 stk' },
      { name: 'Potet', qty: '800 g', home: true },
    ] },
    { label: 'Onsdag', meal: 'Taco', items: [
      { name: 'Kjøttdeig', qty: '500 g' },
      { name: 'Tortilla', qty: '12 stk' },
      { name: 'Rømme', qty: '1 dl', home: true },
    ] },
    { label: 'Torsdag', meal: 'Pasta pesto', items: [
      { name: 'Pasta', qty: '400 g', home: true },
      { name: 'Basilikum', qty: '1 bukett' },
      { name: 'Parmesan', qty: '80 g' },
    ] },
    { label: 'Fredag', meal: 'Fiskekaker', items: [
      { name: 'Fiskekaker', qty: '8 stk' },
      { name: 'Brokkoli', qty: '1 stk' },
      { name: 'Potet', qty: '800 g', home: true },
    ] },
    { label: 'Lørdag', meal: 'Pizza', items: [
      { name: 'Mel', qty: '500 g', home: true },
      { name: 'Mozzarella', qty: '250 g' },
      { name: 'Tomatsaus', qty: '1 glass' },
    ] },
    { label: 'Søndag', meal: 'Søndagsgryte', items: [
      { name: 'Storfe', qty: '700 g' },
      { name: 'Rødvin', qty: '2 dl' },
      { name: 'Gulrot', qty: '300 g', home: true },
    ] },
  ];

  const root = document.querySelector('[data-week]');
  if (root) {
    const labelEl = root.querySelector('[data-day-label]');
    const mealEl = root.querySelector('[data-meal]');
    const stepEl = root.querySelector('[data-step-meal]');
    const shopEl = root.querySelector('[data-shop]');
    let i = 1;

    function render() {
      const day = WEEK[i];
      if (labelEl) labelEl.textContent = day.label;
      if (mealEl) mealEl.textContent = day.meal;
      if (stepEl) stepEl.textContent = day.label + ' blir ' + day.meal.toLowerCase() + '. Porsjoner følger dem som spiser.';
      if (shopEl) {
        shopEl.innerHTML = day.items
          .map(function (item) {
            const cls = item.home ? ' class="home"' : '';
            const right = item.home
              ? '<span class="tag">har hjemme</span>'
              : '<span>' + item.qty + '</span>';
            return '<li' + cls + '><span>' + item.name + '</span>' + right + '</li>';
          })
          .join('');
      }
    }

    const prev = root.querySelector('[data-prev]');
    const next = root.querySelector('[data-next]');
    if (prev) {
      prev.addEventListener('click', function () {
        i = (i + WEEK.length - 1) % WEEK.length;
        render();
      });
    }
    if (next) {
      next.addEventListener('click', function () {
        i = (i + 1) % WEEK.length;
        render();
      });
    }
    render();
  }

  const tabs = document.querySelector('[data-tabs]');
  if (tabs) {
    const buttons = tabs.querySelectorAll('[role="tab"]');
    const panels = tabs.querySelectorAll('[data-panel]');
    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        const id = btn.getAttribute('data-tab');
        buttons.forEach(function (b) {
          b.setAttribute('aria-selected', String(b === btn));
        });
        panels.forEach(function (p) {
          p.hidden = p.getAttribute('data-panel') !== id;
        });
      });
    });
  }
})();
