const base = { viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

export const Icon = {
  sun: () => <svg {...base}><circle cx="10" cy="10" r="3.5" /><path d="M10 1v2M10 17v2M1 10h2M17 10h2M3.6 3.6 5 5M15 15l1.4 1.4M3.6 16.4 5 15M15 5l1.4-1.4" /></svg>,
  moon: () => <svg {...base}><path d="M17 12.2A7.2 7.2 0 0 1 7.8 3a7.2 7.2 0 1 0 9.2 9.2Z" /></svg>,
  monitor: () => <svg {...base}><rect x="2" y="3" width="16" height="11" rx="2" /><path d="M10 14v3M6 17h8" /></svg>,
  arrowLeft: () => <svg {...base}><path d="m9 4-6 6 6 6M3 10h14" /></svg>,
  external: () => <svg {...base}><path d="M11 3h6v6M17 3l-8 8M7 3H3v14h14v-4" /></svg>,
  play: () => <svg {...base}><path d="m7 4 9 6-9 6Z" /></svg>,
  info: () => <svg {...base}><circle cx="10" cy="10" r="7.5" /><path d="M10 9v5M10 6v.1" /></svg>,
  menu: () => <svg {...base}><path d="M3 5h14M3 10h14M3 15h14" /></svg>,
  close: () => <svg {...base}><path d="m4 4 12 12M16 4 4 16" /></svg>,
  search: () => (
    <svg {...base}>
      <circle cx="9" cy="9" r="5.5" />
      <path d="M13 13l4 4" />
    </svg>
  ),
  feed: () => (
    <svg {...base}>
      <path d="M3 15l4.5-5 3 3L17 5" />
      <path d="M12.5 5H17v4.5" />
    </svg>
  ),
  competitors: () => (
    <svg {...base}>
      <circle cx="10" cy="10" r="7" />
      <circle cx="10" cy="10" r="2.6" />
      <path d="M10 1.5v3M10 15.5v3M1.5 10h3M15.5 10h3" />
    </svg>
  ),
  home: () => (
    <svg {...base}>
      <path d="M3.5 9L10 3.5 16.5 9v7.5h-4.5v-4.5H8v4.5H3.5z" />
    </svg>
  ),
  hooks: () => (
    <svg {...base}>
      <path d="M7 3v8a4 4 0 0 0 8 0V9" />
      <path d="M13 11l2-2 2 2" />
    </svg>
  ),
  scripts: () => (
    <svg {...base}>
      <path d="M4 5h12M4 10h12M4 15h7" />
    </svg>
  ),
  analyze: () => (
    <svg {...base}>
      <rect x="5.5" y="2.5" width="9" height="15" rx="2" />
      <path d="M8.5 12l1.5-2 1.5 1.2L13 8" />
    </svg>
  ),
  library: () => (
    <svg {...base}>
      <path d="M3 6.5h14v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9zM3 6.5l1.5-3h11l1.5 3" />
    </svg>
  ),
  usage: () => (
    <svg {...base}>
      <path d="M4 16V9M10 16V4M16 16v-5" />
    </svg>
  ),
  instructions: () => (
    <svg {...base}>
      <path d="M5 2.5h7l3.5 3.5v11.5H5z" />
      <path d="M12 2.5V6h3.5M7.5 10h5M7.5 13h5" />
    </svg>
  ),
  chat: () => (
    <svg {...base}>
      <path d="M3.5 4.5h13v9h-7l-4 3v-3h-2z" />
    </svg>
  ),
  send: () => (
    <svg {...base}>
      <path d="M3 10h11M10 5l5 5-5 5" />
    </svg>
  ),
  upload: () => (
    <svg {...base}>
      <path d="M10 13V3.5M6 7.5l4-4 4 4M3.5 13v3.5h13V13" />
    </svg>
  ),
  settings: () => (
    <svg {...base}>
      <circle cx="10" cy="7" r="3.2" />
      <path d="M3.5 17a6.5 6.5 0 0 1 13 0" />
    </svg>
  ),
};
