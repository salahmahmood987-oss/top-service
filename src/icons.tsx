// أيقونات SVG صغيرة — نفس نمط ind-toktok (stroke بسيط، لون currentColor)
import type { ReactElement } from 'react'

type IconProps = { className?: string }

function Svg({
  className,
  children,
  viewBox = '0 0 24 24',
}: IconProps & { children: ReactElement | ReactElement[]; viewBox?: string }) {
  return (
    <svg
      className={className ?? 'ic'}
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export const CarIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <>
      <path d="M5 11l1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11" />
      <path d="M3 11h18v6h-2.5" />
      <path d="M3 11v6h2.5" />
      <circle cx="7.5" cy="17.5" r="1.8" />
      <circle cx="16.5" cy="17.5" r="1.8" />
      <path d="M9.3 17.5h5.4" />
    </>
  </Svg>
)

export const DropIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M12 3s6 6.2 6 10.5a6 6 0 0 1-12 0C6 9.2 12 3 12 3z" />
  </Svg>
)

export const UserIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" />
    </>
  </Svg>
)

export const UsersIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c1.2-3 3.5-4.5 6.5-4.5s5.3 1.5 6.5 4.5" />
      <path d="M16 5.5a3.5 3.5 0 0 1 0 5.5" />
      <path d="M17.5 15.7c2 .6 3.4 2 4 4.3" />
    </>
  </Svg>
)

export const ShieldIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <>
      <path d="M12 2.5l8 3v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10v-6l8-3z" />
      <path d="M8.5 12l2.5 2.5 4.5-5" />
    </>
  </Svg>
)

export const SearchIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.5-4.5" />
    </>
  </Svg>
)

export const PhoneIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M5 3.5h4l1.5 4.5-2.3 1.8a12 12 0 0 0 6 6l1.8-2.3 4.5 1.5v4a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 3 5.7a2 2 0 0 1 2-2.2z" />
  </Svg>
)

export const LogoutIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <>
      <path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </>
  </Svg>
)

export const CheckIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M4 12.5l5 5L20 6.5" />
  </Svg>
)

export const PlusIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  </Svg>
)

export const XIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </>
  </Svg>
)

export const CalendarIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M3 10h18" />
      <path d="M8 3v4M16 3v4" />
    </>
  </Svg>
)

export const ReceiptIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <>
      <path d="M5 3h14v18l-2.3-1.5L14.5 21l-2.5-1.5L9.5 21l-2.2-1.5L5 21V3z" />
      <path d="M9 8h6M9 12h6" />
    </>
  </Svg>
)

export const BuildingIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <>
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2" />
      <path d="M10 21v-3h4v3" />
    </>
  </Svg>
)

export const HomeIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <>
      <path d="M3 11l9-7 9 7" />
      <path d="M5 10v10h14V10" />
      <path d="M10 20v-6h4v6" />
    </>
  </Svg>
)

export const RefreshIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <>
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <path d="M20 3v5h-5" />
    </>
  </Svg>
)

export const WalletIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <>
      <rect x="3" y="6" width="18" height="14" rx="3" />
      <path d="M3 10h18" />
      <path d="M16 15h2" />
    </>
  </Svg>
)

export const WrenchIcon = ({ className }: IconProps) => (
  <Svg className={className}>
    <path d="M14.5 6.5a4 4 0 0 0-5.6 5L3 17.4V21h3.6l5.9-5.9a4 4 0 0 0 5-5.6l-2.8 2.8-2.5-.7-.7-2.5 3-3z" />
  </Svg>
)
