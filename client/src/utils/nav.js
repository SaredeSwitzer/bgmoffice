export function navClick(e, path, navigate) {
  if (e.metaKey || e.ctrlKey) {
    window.open(path, '_blank', 'noopener,noreferrer')
  } else {
    navigate(path)
  }
}

export function auxNavClick(e, path) {
  if (e.button === 1 && path) {
    e.preventDefault()
    window.open(path, '_blank', 'noopener,noreferrer')
  }
}
