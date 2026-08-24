const storageKey = 'yorumi-cli-theme';
const root = document.documentElement;
const themeToggle = document.querySelector('[data-theme-toggle]');
const themeIcon = themeToggle?.querySelector('.theme-icon');

const icons = {
  moon: `
    <svg viewBox="0 0 24 24" focusable="false">
      <path d="M9.37 5.51A7.35 7.35 0 0 0 9.1 7.5c0 4.08 3.32 7.4 7.4 7.4.68 0 1.35-.09 1.99-.27A7.014 7.014 0 0 1 12 19c-3.86 0-7-3.14-7-7 0-2.93 1.82-5.45 4.37-6.49zM12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-5.4-5.4c0-1.71.8-3.24 2.05-4.23-.38-.17-.76-.27-1.15-.27z"></path>
    </svg>
  `,
  sun: `
    <svg viewBox="0 0 24 24" focusable="false">
      <path d="M6.76 4.84 4.96 3.05 3.55 4.46l1.79 1.79 1.42-1.41ZM1 13h3v-2H1v2Zm10-12h2v3h-2V1Zm9.66 5.25 1.79-1.79-1.41-1.41-1.8 1.79 1.42 1.41ZM17.24 19.16l1.8 1.79 1.41-1.41-1.79-1.8-1.42 1.42ZM20 11v2h3v-2h-3Zm-8-5a6 6 0 1 0 0 12 6 6 0 0 0 0-12Zm0 10a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm-1 7h2v-3h-2v3Zm-7.45-3.46 1.41 1.41 1.8-1.79-1.42-1.42-1.79 1.8Z"></path>
    </svg>
  `,
};

const getPreferredTheme = () => {
  const saved = localStorage.getItem(storageKey);
  if (saved === 'light' || saved === 'dark') return saved;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
};

const setTheme = (theme) => {
  root.setAttribute('data-theme', theme);
  localStorage.setItem(storageKey, theme);
  themeToggle?.setAttribute('aria-checked', String(theme === 'dark'));
  themeToggle?.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`);
  if (themeIcon) {
    themeIcon.innerHTML = theme === 'dark' ? icons.moon : icons.sun;
  }
};

setTheme(getPreferredTheme());

const canUseViewTransition = () => (
  'startViewTransition' in document
  && window.matchMedia('(prefers-reduced-motion: no-preference)').matches
);

themeToggle?.addEventListener('click', async (event) => {
  const nextTheme = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';

  if (!canUseViewTransition()) {
    setTheme(nextTheme);
    return;
  }

  const { clientX, clientY } = event;
  const radius = Math.hypot(
    Math.max(clientX, window.innerWidth - clientX),
    Math.max(clientY, window.innerHeight - clientY),
  );
  const clipPath = [
    `circle(0px at ${clientX}px ${clientY}px)`,
    `circle(${radius}px at ${clientX}px ${clientY}px)`,
  ];

  const transition = document.startViewTransition(() => {
    setTheme(nextTheme);
  });

  await transition.ready;

  root.animate(
    { clipPath: nextTheme === 'dark' ? [...clipPath].reverse() : clipPath },
    {
      duration: 300,
      easing: 'ease-in',
      pseudoElement: `::view-transition-${nextTheme === 'dark' ? 'old' : 'new'}(root)`,
    },
  );
});

document.querySelectorAll('[data-tabs]').forEach((tabs) => {
  const buttons = Array.from(tabs.querySelectorAll('[data-tab-button]'));
  const panels = Array.from(tabs.querySelectorAll('[data-tab-panel]'));

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.getAttribute('data-tab-button');
      buttons.forEach((item) => item.classList.toggle('active', item === button));
      panels.forEach((panel) => {
        panel.classList.toggle('active', panel.getAttribute('data-tab-panel') === target);
      });
    });
  });
});

document.querySelectorAll('pre').forEach((pre) => {
  if (pre.closest('.terminal-window') || pre.closest('.code-window') || pre.classList.contains('ascii-banner')) return;

  const codeWindow = document.createElement('div');
  codeWindow.className = 'code-window';

  const titlebar = document.createElement('div');
  titlebar.className = 'code-titlebar';

  const dots = document.createElement('div');
  dots.className = 'window-dots';
  dots.setAttribute('aria-hidden', 'true');
  dots.innerHTML = '<span></span><span></span><span></span>';
  titlebar.appendChild(dots);

  const body = document.createElement('div');
  body.className = 'code-body';

  const copyButton = document.createElement('button');
  copyButton.className = 'copy-button';
  copyButton.type = 'button';
  copyButton.setAttribute('aria-label', 'Copy command');
  copyButton.innerHTML = '<ion-icon name="copy-outline"></ion-icon>';

  pre.parentNode.insertBefore(codeWindow, pre);
  body.appendChild(pre);
  body.appendChild(copyButton);
  codeWindow.appendChild(titlebar);
  codeWindow.appendChild(body);

  copyButton.addEventListener('click', async () => {
    const commandText = pre.textContent.trim();
    await navigator.clipboard.writeText(commandText);
    copyButton.innerHTML = '<ion-icon name="checkmark-outline"></ion-icon>';
    window.setTimeout(() => {
      copyButton.innerHTML = '<ion-icon name="copy-outline"></ion-icon>';
    }, 1200);
  });
});

document.querySelectorAll('.cmd').forEach((cmdSpan) => {
  let html = cmdSpan.textContent;
  
  html = html
    .replace(/((?:"[^"]*")|(?:'[^']*'))/g, '<span class=cmd-string>$1</span>')
    .replace(/(?<=^|\s)(yorumi-cli|iwr|scoop|curl|iex|bash)(?=\s|$)/g, '<span class=cmd-app>$1</span>')
    .replace(/(?<=^|\s)(-[a-zA-Z0-9]+|--[a-zA-Z0-9\-]+)(?=\s|$)/g, '<span class=cmd-flag>$1</span>')
    .replace(/(\|)/g, '<span class=cmd-pipe>$1</span>');

  cmdSpan.innerHTML = html;
});

const docsSidebarLinks = Array.from(document.querySelectorAll('[data-docs-nav]'));
const tocGroups = Array.from(document.querySelectorAll('[data-toc-group]'));
const tocLinks = Array.from(document.querySelectorAll('.docs-toc a[href^="#"]'));

const setDocsMode = (mode) => {
  docsSidebarLinks.forEach((link) => {
    link.classList.toggle('active', link.getAttribute('data-docs-nav') === mode);
  });
  tocGroups.forEach((group) => {
    group.classList.toggle('active', group.getAttribute('data-toc-group') === mode);
  });
};

const setActiveTocLink = (id) => {
  tocLinks.forEach((link) => {
    link.classList.toggle('active', link.getAttribute('href') === `#${id}`);
  });
};

if (docsSidebarLinks.length && tocGroups.length) {
  const modeTargets = [
    document.getElementById('getting-started'),
    document.getElementById('changelogs'),
  ].filter(Boolean);

  const tocTargets = tocLinks
    .map((link) => document.getElementById(link.getAttribute('href').slice(1)))
    .filter(Boolean);

  const updateDocsNavigation = () => {
    const offset = 116;
    const mode = (document.getElementById('changelogs')?.getBoundingClientRect().top ?? Infinity) <= offset
      ? 'changelogs'
      : 'getting-started';

    setDocsMode(mode);

    const activeTarget = tocTargets
      .filter((target) => target.getBoundingClientRect().top <= offset)
      .pop() ?? tocTargets[0];

    if (activeTarget) setActiveTocLink(activeTarget.id);
  };

  updateDocsNavigation();
  window.addEventListener('scroll', updateDocsNavigation, { passive: true });
  window.addEventListener('hashchange', updateDocsNavigation);

  modeTargets.forEach((target) => {
    target.addEventListener('focus', updateDocsNavigation);
  });
}
