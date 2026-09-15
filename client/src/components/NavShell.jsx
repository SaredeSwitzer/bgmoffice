import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import ErrorBoundary from './ErrorBoundary'
import PasskeyPrompt from './PasskeyPrompt'
import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { RemindersProvider, useRemindersContext } from '../context/RemindersContext'
import { UnreadTextsProvider, useUnreadTexts } from '../context/UnreadTextsContext'
import { VoiceProvider, useVoice } from '../context/VoiceContext'
import Softphone from './Softphone'
import AmberChat from './AmberChat'
import { isSaredeUser } from '../utils/saredeAccess'
import { loadDirectory } from '../utils/directory'

// The bell in the top bar: quiet when there's nothing, a red count when there is.
function TextsBell({ count, onGo }) {
  const has = count > 0
  return (
    <button
      onClick={onGo}
      title={has
        ? `${count} unread text${count === 1 ? '' : 's'} — open the Texts inbox`
        : 'No unread texts'}
      aria-label={has ? `${count} unread texts` : 'Texts'}
      className="relative p-2 rounded-lg text-white hover:bg-white/15 shrink-0 ml-auto sm:ml-0"
    >
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0a3 3 0 11-6 0m6 0H9" />
      </svg>
      {has && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  )
}

// Whether a new text makes a sound. Sits next to the bell because that is where someone
// goes when the noise is the thing they want to stop.
function TextsSoundToggle({ on, onToggle }) {
  return (
    <button
      onClick={onToggle}
      title={on ? 'New texts make a sound — click to silence' : 'New texts are silent — click to turn the sound on'}
      aria-label={on ? 'Silence new text sound' : 'Turn on new text sound'}
      className="p-2 rounded-lg text-white/70 hover:bg-white/15 hover:text-white shrink-0"
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5L6 9H3v6h3l5 4V5z" />
        {on
          ? <path strokeLinecap="round" strokeLinejoin="round" d="M15.5 8.5a5 5 0 010 7M18 6a8 8 0 010 12" />
          : <path strokeLinecap="round" strokeLinejoin="round" d="M16 9l5 6m0-6l-5 6" />}
      </svg>
    </button>
  )
}

function Shell() {
  const { user, logout } = useAuth()
  // Fetched once behind the whole signed-in app: note text renders client/instructor
  // links from it (utils/mentions.jsx), and every screen showing a note would otherwise
  // need its own copy.
  useEffect(() => { if (user) loadDirectory() }, [user])
  const { overdueCount } = useRemindersContext()
  const { unread: unreadTexts, soundOn, toggleSound } = useUnreadTexts()
  const voice = useVoice()
  const navigate = useNavigate()
  const location = useLocation()
  const [open, setOpen] = useState(false)

  function handleLogout() {
    logout()
    navigate('/login')
    setOpen(false)
  }

  const navLinks = [
    { to: '/my-tasks',    label: 'My Tasks' },
    { to: '/clients',     label: 'Clients' },
    { to: '/instructors', label: 'Instructors' },
    { to: '/schedule',   label: 'Schedule' },
    ...(isSaredeUser(user) ? [{ to: '/billing', label: 'Billing' }] : []),
    { to: '/reminders',  label: overdueCount > 0 ? `Reminders (${overdueCount})` : 'Reminders' },
    // Texts and calls are one heading. They are the same conversation with the same
    // person on the same number; two tabs inside the page keep them apart without
    // spending two slots in the bar. `end: false` so it stays lit on either one.
    { to: '/sms', label: unreadTexts > 0 ? `Phone (${unreadTexts})` : 'Phone', alsoActiveOn: ['/calls'] },
    { to: '/recruiting', label: 'Recruiting' },
    { to: '/reference',  label: 'Reference' },
    ...(user?.role === 'admin' ? [{ to: '/settings', label: 'Settings' }] : []),
  ]

  // The mobile dropdown hangs below the bar on a white panel, so it keeps the
  // light treatment; only the bar itself is blue.
  const linkClass = ({ isActive }) =>
    `block px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
      isActive ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
    }`

  // On the blue bar the selected tab is a white chip — the one bright thing up
  // there, so where you are reads at a glance.
  const desktopLinkClass = ({ isActive }) =>
    `px-2.5 py-1.5 rounded text-sm font-medium whitespace-nowrap transition-colors ${
      isActive
        ? 'bg-white text-blue-700 font-semibold shadow-sm'
        : 'text-blue-50 hover:text-white hover:bg-white/15'
    }`

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <PasskeyPrompt />

      {/* Header */}
      <header className="bg-brand-bar border-b border-brand-bar-edge shadow-sm sticky top-0 z-40">
        <div className="px-4 h-14 flex items-center justify-between max-w-7xl mx-auto">

          {/* Logo — always visible, and the way home. It replaces a Dashboard tab: the
              bar had run out of room, and the logo is where people already click to get
              back to the start. Points at "/" rather than /dashboard so RoleHome decides
              where this account belongs. */}
          <NavLink
            to="/"
            title="Dashboard"
            className="font-display font-bold text-white text-base tracking-tight shrink-0 flex items-center gap-2 rounded px-1 py-0.5 hover:bg-white/15"
          >
            <img src="/logo-mark.svg" alt="" aria-hidden="true" className="w-[18px] h-[18px]" />
            BGM Office
          </NavLink>

          {/* Desktop nav — hidden on mobile */}
          {/* min-w-0 + scroll rather than letting the tabs push everything along: adding
              one more tab shoved "Sign out" off the right-hand edge of the bar. */}
          <nav className="hidden sm:flex items-center gap-0.5 mx-2 min-w-0 overflow-x-auto scrollbar-none">
            {navLinks.map(({ to, label, alsoActiveOn }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  desktopLinkClass({ isActive: isActive || (alsoActiveOn || []).includes(location.pathname) })}
              >
                {label}
              </NavLink>
            ))}
          </nav>

          {/* Unread texts, from wherever you are. A reply used to arrive silently unless
              you happened to be sitting on the Texts screen. */}
          <TextsBell count={unreadTexts} onGo={() => { navigate('/sms'); setOpen(false) }} />
          <TextsSoundToggle on={soundOn} onToggle={toggleSound} />

          {/* Desktop user info — hidden on mobile */}
          <div className="hidden sm:flex items-center gap-3 shrink-0">
            <span className="text-xs text-blue-50 flex items-center gap-1.5" title={user?.name}>
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-white/20 text-white font-bold text-xs">
                {user?.initials}
              </span>
              <span className="hidden lg:inline">{user?.name}</span>
            </span>
            <button onClick={handleLogout} className="text-xs text-blue-100 hover:text-white">
              Sign out
            </button>
          </div>

          {/* Hamburger — mobile only */}
          <button
            className="sm:hidden p-2 rounded-lg text-white hover:bg-white/15"
            onClick={() => setOpen(o => !o)}
            aria-label="Toggle menu"
          >
            {open ? (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>

        {/* Mobile dropdown — all nav links + sign out */}
        {open && (
          <div className="sm:hidden border-t border-gray-100 bg-white px-3 py-2 pb-20 space-y-1">{/* pb-20: Amber floats over the bottom-right corner and was sitting on top of Sign out, the last row in this menu. */}
            {navLinks.map(({ to, label, alsoActiveOn }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  linkClass({ isActive: isActive || (alsoActiveOn || []).includes(location.pathname) })}
                onClick={() => setOpen(false)}
              >
                {label}
              </NavLink>
            ))}
            {/* The phone lives here on mobile. Its floating pill is hidden on small
                screens because it sat on top of the reply box in a conversation, so
                without this there would be no way to turn the phone on from a phone. */}
            <button
              onClick={() => voice?.toggle(!voice.enabled)}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              <span className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${
                  voice?.status === 'ready' ? 'bg-green-500'
                  : voice?.status === 'error' ? 'bg-red-500' : 'bg-gray-300'}`} />
                {voice?.status === 'ready' ? 'Phone on — calls ring here'
                  : voice?.status === 'connecting' ? 'Phone connecting…'
                  : voice?.status === 'error' ? 'Phone problem'
                  : 'Phone off'}
              </span>
              <span className="text-xs text-blue-600">{voice?.enabled ? 'Turn off' : 'Turn on'}</span>
            </button>

            <div className="border-t border-gray-100 mt-2 pt-2 flex items-center justify-between px-4 py-2">
              <span className="text-xs text-gray-500 flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-200 text-gray-700 font-bold text-xs">
                  {user?.initials}
                </span>
                {user?.name}
              </span>
              <button onClick={handleLogout} className="text-xs text-red-500 hover:text-red-700 font-medium">
                Sign out
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Page content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 py-4 sm:py-6 pb-6">
        <ErrorBoundary key={location.pathname} what="this page">
          <Outlet />
        </ErrorBoundary>
      </main>

      {/* Amber floating chat */}
      <AmberChat />
    </div>
  )
}

export default function NavShell() {
  return (
    <RemindersProvider>
      <UnreadTextsProvider>
        <VoiceProvider>
          <Shell />
          {/* Outside Shell so a ringing call survives moving between pages. */}
          <Softphone />
        </VoiceProvider>
      </UnreadTextsProvider>
    </RemindersProvider>
  )
}
