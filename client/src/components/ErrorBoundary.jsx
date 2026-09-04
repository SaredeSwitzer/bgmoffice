import { Component } from 'react'

// Stops one broken thing from taking the whole screen with it.
//
// React's default when a component throws while rendering is to unmount the entire tree —
// so a single bad value (a list that arrived as an object, say) leaves a blank white page
// with nothing on it. That reads as "the app is broken" rather than "one part is", which
// is both frightening and useless: there's nothing on screen to report, and no way to get
// to the rest of the app without knowing to retype the URL.
//
// This catches the throw and keeps everything outside it alive. Has to be a class — React
// gives hooks no way to catch a render error.

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // No error tracking service yet, so the console is the only record. Worth having:
    // it's what turns "the page went white" into something findable.
    console.error('[bgm] a section crashed:', error, info?.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    const what = this.props.what || 'this part of the page'

    return (
      <div className="max-w-xl mx-auto my-10 rounded-2xl border border-amber-200 bg-amber-50/60 px-5 py-4">
        <p className="text-sm font-bold text-gray-900 mb-1">
          Something went wrong loading {what}.
        </p>
        <p className="text-xs text-gray-600 mb-3">
          The rest of the app is fine — use the menu above to carry on. If it keeps happening
          here, tell Claude what page you were on and it can be traced from this message.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => this.setState({ error: null })}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700"
          >
            Try again
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-300 text-gray-700 hover:bg-white"
          >
            Reload the page
          </button>
        </div>
        {/* The actual message, folded away. Useless to read day to day, but it is the one
            thing that makes the fault identifiable without a reproduction. */}
        <details className="mt-3">
          <summary className="text-[11px] text-gray-400 cursor-pointer hover:text-gray-600">
            Technical detail
          </summary>
          <pre className="mt-1 text-[10px] text-gray-500 whitespace-pre-wrap break-words">
            {String(this.state.error?.message || this.state.error)}
          </pre>
        </details>
      </div>
    )
  }
}
