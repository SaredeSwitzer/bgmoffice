// Turning a carrier's reason for refusing a text into something worth reading.
//
// Telnyx hands back a code and a line of its own prose. The prose is usually accurate but
// written for a developer — "Destination unreachable or does not support SMS" does not
// tell an office manager what to DO. What she needs is the difference between "that is a
// landline, get a mobile number" and "their phone was off, try again", because one of
// those is a data-entry job and the other is nothing.
//
// Matched on the words Telnyx uses rather than on code numbers: the codes are not
// documented consistently enough to key behaviour off, and guessing at a number's meaning
// would put confident wrong advice in front of her. The original wording is always kept
// and shown alongside, so nothing is hidden behind our paraphrase.

const RULES = [
  {
    match: /landline|does not support sms|not sms.?(capable|enabled)|unsupported/i,
    plain: 'That number can’t receive texts — it’s most likely a landline.',
    fix: 'Ask them for a mobile number.',
  },
  {
    match: /opt(ed)?.?out|unsubscrib|stop request|blocked by (the )?(subscriber|recipient)/i,
    plain: 'They’ve replied STOP, so the carrier is blocking our texts to them.',
    fix: 'They have to text START to this number before we can text them again.',
  },
  {
    match: /invalid|malformed|not a valid|no route|unallocated|does not exist/i,
    plain: 'That doesn’t look like a working number.',
    fix: 'Worth checking the number on their profile.',
  },
  {
    match: /unreachable|unavailable|handset|switched off|out of coverage/i,
    plain: 'Their phone couldn’t be reached — switched off, or no signal.',
    fix: 'Usually worth trying again later.',
  },
  {
    match: /spam|filtered|blocked by carrier|content|violat/i,
    plain: 'The carrier blocked this one as suspected spam.',
    fix: 'Often the wording or a link. Try again more plainly, or call instead.',
  },
  {
    match: /queue|expired|timeout|ttl/i,
    plain: 'The carrier kept it queued too long and gave up.',
    fix: 'Try sending it again.',
  },
];

// Returns { plain, fix } — never null, because "we don't know" still has to say something
// useful rather than leave a blank space where an explanation should be.
function explainSmsFailure(detail, code) {
  const text = `${detail || ''} ${code || ''}`.trim();
  for (const r of RULES) {
    if (r.match.test(text)) return { plain: r.plain, fix: r.fix };
  }
  return {
    plain: 'The carrier wouldn’t deliver this one.',
    fix: 'Try again, or reach them another way.',
  };
}

module.exports = { explainSmsFailure };
