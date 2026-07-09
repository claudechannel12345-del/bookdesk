// Small inline icon set — stroke follows currentColor so themes come free.
const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true
}

export const IcUndo = (): React.JSX.Element => (
  <svg {...base}>
    <path d="M6.5 3.5 3 7l3.5 3.5" />
    <path d="M3 7h6a4 4 0 0 1 0 8H8" transform="translate(0,-2)" />
  </svg>
)
export const IcRedo = (): React.JSX.Element => (
  <svg {...base}>
    <path d="M9.5 3.5 13 7 9.5 10.5" />
    <path d="M13 7H7a4 4 0 0 0 0 8h1" transform="translate(0,-2)" />
  </svg>
)
export const IcAlignLeft = (): React.JSX.Element => (
  <svg {...base}>
    <path d="M2.5 4h11M2.5 7h7M2.5 10h11M2.5 13h7" transform="translate(0,-0.5)" />
  </svg>
)
export const IcAlignCenter = (): React.JSX.Element => (
  <svg {...base}>
    <path d="M2.5 4h11M4.5 7h7M2.5 10h11M4.5 13h7" transform="translate(0,-0.5)" />
  </svg>
)
export const IcAlignRight = (): React.JSX.Element => (
  <svg {...base}>
    <path d="M2.5 4h11M6.5 7h7M2.5 10h11M6.5 13h7" transform="translate(0,-0.5)" />
  </svg>
)
export const IcAlignJustify = (): React.JSX.Element => (
  <svg {...base}>
    <path d="M2.5 4h11M2.5 7h11M2.5 10h11M2.5 13h11" transform="translate(0,-0.5)" />
  </svg>
)
export const IcBullets = (): React.JSX.Element => (
  <svg {...base}>
    <path d="M6 4.5h7.5M6 8h7.5M6 11.5h7.5" />
    <circle cx="3" cy="4.5" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="3" cy="8" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="3" cy="11.5" r="0.9" fill="currentColor" stroke="none" />
  </svg>
)
export const IcNumbers = (): React.JSX.Element => (
  <svg {...base}>
    <path d="M6.5 4.5H14M6.5 8H14M6.5 11.5H14" />
    <path
      d="M2 3.2 3.2 2.6v3.4M2 7.2h2.2L2 9.4h2.2M2 11h1.6a.9.9 0 0 1 0 1.7H2.8h.8a.9.9 0 0 1 0 1.7H2"
      strokeWidth="1.1"
    />
  </svg>
)
export const IcOutdent = (): React.JSX.Element => (
  <svg {...base}>
    <path d="M2.5 3.5h11M8.5 7h5M8.5 9.5h5M2.5 13h11" />
    <path d="M5.5 6.5 3 8.25l2.5 1.75" />
  </svg>
)
export const IcIndent = (): React.JSX.Element => (
  <svg {...base}>
    <path d="M2.5 3.5h11M8.5 7h5M8.5 9.5h5M2.5 13h11" />
    <path d="M3 6.5 5.5 8.25 3 10" />
  </svg>
)
export const IcQuote = (): React.JSX.Element => (
  <svg {...base}>
    <path
      d="M3 9.5c0-3 1.2-5 3.5-6-1.2 1.2-1.5 2.3-1.5 3.5H6.5v4H3v-1.5ZM9 9.5c0-3 1.2-5 3.5-6-1.2 1.2-1.5 2.3-1.5 3.5h1.5v4H9v-1.5Z"
      fill="currentColor"
      stroke="none"
    />
  </svg>
)
export const IcClearFormat = (): React.JSX.Element => (
  <svg {...base}>
    <path d="M4 3h8M8 3l-2.2 8" />
    <path d="M3.5 13.5 13 4" opacity="0" />
    <path d="M10.5 10.5l3 3M13.5 10.5l-3 3" />
  </svg>
)
export const IcSun = (): React.JSX.Element => (
  <svg {...base}>
    <circle cx="8" cy="8" r="3" />
    <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1" />
  </svg>
)
export const IcMoon = (): React.JSX.Element => (
  <svg {...base}>
    <path d="M13.5 9.5A5.8 5.8 0 0 1 6.5 2.5 5.8 5.8 0 1 0 13.5 9.5Z" />
  </svg>
)
export const IcSearch = (): React.JSX.Element => (
  <svg {...base}>
    <circle cx="7" cy="7" r="4.2" />
    <path d="m10.2 10.2 3.3 3.3" />
  </svg>
)
export const IcHistory = (): React.JSX.Element => (
  <svg {...base}>
    <path d="M2.8 8a5.2 5.2 0 1 1 1.5 3.7" />
    <path d="M2.5 8.5v-2.3h2.3" transform="translate(0,3.2)" />
    <path d="M8 5.2V8l2 1.4" />
  </svg>
)
export const IcClose = (): React.JSX.Element => (
  <svg {...base}>
    <path d="m4 4 8 8M12 4l-8 8" />
  </svg>
)
export const IcChevronDown = (): React.JSX.Element => (
  <svg {...base} width={12} height={12}>
    <path d="m4 6.2 4 4 4-4" />
  </svg>
)
export const IcArrowUp = (): React.JSX.Element => (
  <svg {...base}>
    <path d="M8 13V3M4 7l4-4 4 4" />
  </svg>
)
export const IcArrowDown = (): React.JSX.Element => (
  <svg {...base}>
    <path d="M8 3v10M4 9l4 4 4-4" />
  </svg>
)
export const IcBook = ({ size = 20 }: { size?: number }): React.JSX.Element => (
  <svg {...base} width={size} height={size} viewBox="0 0 20 20" strokeWidth={1.4}>
    <path d="M10 4.2C8.6 3 6.6 2.6 4 2.6c-.6 0-1 .4-1 1v10.6c0 .6.4 1 1 1 2.6 0 4.6.4 6 1.6 1.4-1.2 3.4-1.6 6-1.6.6 0 1-.4 1-1V3.6c0-.6-.4-1-1-1-2.6 0-4.6.4-6 1.6Z" />
    <path d="M10 4.2v12.6" />
  </svg>
)
