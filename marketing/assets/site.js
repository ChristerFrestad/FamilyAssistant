(function () {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const topbar = document.querySelector('.topbar');
  if (topbar) {
    const onScroll = () => topbar.classList.toggle('is-slim', window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  const menuBtn = document.querySelector('.menu-btn');
  const nav = document.querySelector('.nav');
  if (menuBtn && nav) {
    menuBtn.addEventListener('click', () => {
      const open = nav.classList.toggle('is-open');
      menuBtn.setAttribute('aria-expanded', String(open));
    });
  }

  const themeBtn = document.querySelector('[data-theme-toggle]');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try {
        localStorage.setItem('hp-theme', next);
      } catch {
        /* ignore */
      }
    });
  }
  try {
    const saved = localStorage.getItem('hp-theme');
    if (saved === 'dark' || saved === 'light') {
      document.documentElement.setAttribute('data-theme', saved);
    }
  } catch {
    /* ignore */
  }

  const frames = Array.from(document.querySelectorAll('[data-device-frame] img'));
  if (frames.length > 1 && !reduce) {
    let i = 0;
    frames[0].classList.add('is-on');
    window.setInterval(() => {
      frames[i].classList.remove('is-on');
      i = (i + 1) % frames.length;
      frames[i].classList.add('is-on');
    }, 2800);
  } else if (frames[0]) {
    frames[0].classList.add('is-on');
  }

  const WEEK = [
    {
      key: 'man',
      label: 'Man',
      meal: 'Gryte med rotgrønnsaker',
      items: [
        { name: 'Gulrot', qty: '400 g' },
        { name: 'Løk', qty: '2 stk' },
        { name: 'Fløte', qty: '2 dl', home: true },
      ],
    },
    {
      key: 'tir',
      label: 'Tir',
      meal: 'Lakseovn',
      items: [
        { name: 'Laks', qty: '600 g' },
        { name: 'Sitron', qty: '1 stk' },
        { name: 'Potet', qty: '800 g', home: true },
      ],
    },
    {
      key: 'ons',
      label: 'Ons',
      meal: 'Taco',
      items: [
        { name: 'Kjøttdeig', qty: '500 g' },
        { name: 'Tortilla', qty: '12 stk' },
        { name: 'Rømme', qty: '1 dl', home: true },
      ],
    },
    {
      key: 'tor',
      label: 'Tor',
      meal: 'Pasta pesto',
      items: [
        { name: 'Pasta', qty: '400 g', home: true },
        { name: 'Basilikum', qty: '1 bukett' },
        { name: 'Parmesan', qty: '80 g' },
      ],
    },
    {
      key: 'fre',
      label: 'Fre',
      meal: 'Fiskekaker',
      items: [
        { name: 'Fiskekaker', qty: '8 stk' },
        { name: 'Brokkoli', qty: '1 stk' },
        { name: 'Potet', qty: '800 g', home: true },
      ],
    },
    {
      key: 'lør',
      label: 'Lør',
      meal: 'Pizza',
      items: [
        { name: 'Mel', qty: '500 g', home: true },
        { name: 'Mozzarella', qty: '250 g' },
        { name: 'Tomatsaus', qty: '1 glass' },
      ],
    },
    {
      key: 'søn',
      label: 'Søn',
      meal: 'Søndagsgryte',
      items: [
        { name: 'Storfe', qty: '700 g' },
        { name: 'Rødvin', qty: '2 dl' },
        { name: 'Gulrot', qty: '300 g', home: true },
      ],
    },
  ];

  const daysEl = document.querySelector('[data-days]');
  const mealEl = document.querySelector('[data-meal]');
  const shopEl = document.querySelector('[data-shop]');
  if (daysEl && mealEl && shopEl) {
    let current = 1;

    function render(index) {
      current = index;
      const day = WEEK[index];
      daysEl.querySelectorAll('.day').forEach((btn, i) => {
        btn.classList.toggle('is-on', i === index);
        btn.setAttribute('aria-pressed', String(i === index));
      });
      mealEl.textContent = day.meal;
      shopEl.innerHTML = day.items
        .map((item) => {
          const cls = item.home ? ' class="home"' : '';
          const tag = item.home ? '<span class="tag">har hjemme</span>' : `<span>${item.qty}</span>`;
          return `<li${cls}><span>${item.name}</span>${tag}</li>`;
        })
        .join('');
    }

    WEEK.forEach((day, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'day';
      btn.dataset.index = String(index);
      btn.innerHTML = `<small>${day.label}</small>${day.meal.split(' ')[0]}`;
      btn.addEventListener('click', () => {
        render(index);
        paused = true;
      });
      daysEl.appendChild(btn);
    });
    render(current);

    let paused = false;
    if (!reduce) {
      window.setInterval(() => {
        if (paused) return;
        render((current + 1) % WEEK.length);
      }, 3200);
    }
    daysEl.addEventListener('mouseenter', () => {
      paused = true;
    });
    daysEl.addEventListener('focusin', () => {
      paused = true;
    });
  }

  if (!reduce && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('reveal');
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.16 }
    );
    document.querySelectorAll('[data-reveal]').forEach((el) => io.observe(el));
  } else {
    document.querySelectorAll('[data-reveal]').forEach((el) => el.classList.add('reveal'));
  }
})();
