import { useState } from 'react'
import { api } from '../api/client'

// Client's rate_per_class is free text ("105", "$125 or $150 if...", etc.) — if it
// already reads like a sentence (has a $ or letters), leave it alone; a bare number gets
// wrapped into "$X per class" so the waiver states a plain amount instead of a stray digit.
function formatRateForWaiver(rate) {
  const trimmed = rate?.trim()
  if (!trimmed) return ''
  return /[$a-zA-Z]/.test(trimmed) ? trimmed : `$${trimmed} per class`
}

// Step 1: org details + custom payment terms/deposit for this org. Step 2: preview the
// invite email and edit before sending — same pattern as the instructor contract invite.
//
// Pass `client` ({ id, name, email, phone }) when sending to a specific, already-on-file
// client (e.g. from their profile page) — prefills who they are and links the signature
// to them up front, so their waiver flips to "signed" the moment they sign instead of
// needing a manual match-up in the signatures list afterward. Payment terms/deposit are
// still entered fresh each time since those vary invite to invite.
export default function ClientContractInviteModal({ client, onClose, onSent }) {
  const [orgName, setOrgName] = useState(client?.name || '')
  const [contactName, setContactName] = useState('')
  const [email, setEmail] = useState(client?.email || '')
  const [phone, setPhone] = useState(client?.phone || '')
  const [paymentTerms, setPaymentTerms] = useState(formatRateForWaiver(client?.rate_per_class))
  const [depositAmount, setDepositAmount] = useState('')
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [signatureId, setSignatureId] = useState(null)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [link, setLink] = useState('')
  const [linkCopied, setLinkCopied] = useState(false)

  async function handlePreview(e) {
    e.preventDefault()
    if (!email.trim() && !phone.trim()) {
      setError('Enter an email, or at least a phone number if you plan to text/WhatsApp the link instead.')
      return
    }
    setLoadingPreview(true)
    setError('')
    try {
      const p = await api.getClientContractInvitePreview({
        org_name: orgName.trim(), contact_name: contactName.trim(), email: email.trim(),
        phone: phone.trim(), payment_terms_text: paymentTerms.trim(),
        deposit_amount: depositAmount === '' ? null : depositAmount,
        client_id: client?.id,
      })
      setSignatureId(p.signature_id)
      setSubject(p.subject)
      setBody(p.body)
      setLink(p.link)
    } catch (err) {
      setError(err.message || 'Failed to build preview.')
    } finally {
      setLoadingPreview(false)
    }
  }

  async function handleSend() {
    setSending(true)
    setError('')
    try {
      await api.sendClientContractInvite(signatureId, { email: email.trim(), subject, body })
      setSent(true)
      onSent?.()
    } catch (err) {
      setError(err.message || 'Failed to send invite.')
    } finally {
      setSending(false)
    }
  }

  // Copying the link counts as "shared" the same as emailing it — records sent_at
  // without actually sending an email, so it shows correctly in the signatures list
  // instead of sitting there looking untouched.
  async function handleCopyLink() {
    await navigator.clipboard.writeText(link)
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 2500)
    try {
      await api.sendClientContractInvite(signatureId, {})
      onSent?.()
    } catch {
      // Link is already copied either way — not worth surfacing a failed sent_at bookkeeping write.
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 pt-6">
          <h3 className="font-bold text-gray-900">
            {client ? `Send Waiver/Contract to Sign · ${client.name}` : 'Send Contract to Sign'}
          </h3>
          <p className="text-xs text-gray-500 mt-1 mb-4">
            Emails a unique signing link, or copy it to text/WhatsApp instead —
            {client ? ' their profile updates to "signed" as soon as they do.' : ' no client record needed.'}
          </p>
        </div>

        {sent ? (
          <div className="px-6 pb-6">
            <p className="text-sm text-gray-600 mb-4">
              {client
                ? `The contract was emailed to ${email}.`
                : `The contract was emailed to ${email}. Once they sign (and pay any deposit), it'll show up in the signatures list — and if you add them as a client with this same email, it'll link automatically.`}
            </p>
            <button onClick={onClose}
              className="w-full bg-gray-900 text-white py-2 rounded-lg text-sm font-medium hover:bg-gray-700">
              Done
            </button>
          </div>
        ) : !signatureId ? (
          <form onSubmit={handlePreview} className="px-6 pb-6 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Organization Name</label>
                <input value={orgName} onChange={e => setOrgName(e.target.value)}
                  placeholder="Camp Ruach"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Contact Name</label>
                <input value={contactName} onChange={e => setContactName(e.target.value)}
                  placeholder="Jane Doe"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Phone</label>
                <input value={phone} onChange={e => setPhone(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="jane@example.com — leave blank if texting/WhatsApping the link instead"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Payment Terms (shown on the signing page)</label>
              <textarea value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)}
                rows={5} placeholder="e.g. rate breakdown, schedule, total cost…"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-300" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Deposit Due Now ($) — leave blank for none</label>
              <input type="number" step="1" min="0" value={depositAmount} onChange={e => setDepositAmount(e.target.value)}
                placeholder="1160"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-300" />
              <p className="text-[11px] text-gray-400 mt-1">If set, they must pay this by card on the signing page before they can sign.</p>
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex gap-3 pt-1">
              <button type="submit" disabled={loadingPreview}
                className="flex-1 bg-gray-900 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-gray-700 transition-colors">
                {loadingPreview ? 'Loading…' : 'Get Signing Link'}
              </button>
              <button type="button" onClick={onClose}
                className="flex-1 border border-gray-300 text-gray-700 py-2 rounded-lg text-sm font-medium hover:bg-gray-50">
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="px-6 pb-6 space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Signing Link</label>
              <div className="flex gap-2">
                <div className="flex-1 text-sm text-gray-800 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5 truncate">
                  {link}
                </div>
                <button type="button" onClick={handleCopyLink}
                  className="px-3 py-1.5 border border-gray-300 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-50 whitespace-nowrap">
                  {linkCopied ? '✓ Copied' : '📋 Copy Link'}
                </button>
              </div>
              <p className="text-[11px] text-gray-400 mt-1">Paste this into a text or WhatsApp message — copying marks it as shared either way.</p>
            </div>
            {email && (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
                  <div className="text-sm text-gray-800 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5">
                    {email}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Subject</label>
                  <input value={subject} onChange={e => setSubject(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Message</label>
                  <textarea value={body} onChange={e => setBody(e.target.value)} rows={8}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono leading-relaxed" />
                </div>
              </>
            )}
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex gap-3 pt-1">
              {email && (
                <button type="button" onClick={handleSend} disabled={sending}
                  className="flex-1 bg-gray-900 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-gray-700 transition-colors">
                  {sending ? 'Sending…' : 'Send Invite'}
                </button>
              )}
              <button type="button" onClick={onClose}
                className={`${email ? '' : 'flex-1'} border border-gray-300 text-gray-700 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 px-4`}>
                {email ? 'Cancel' : 'Done'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
