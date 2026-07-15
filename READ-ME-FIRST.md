# Good morning — here's everything we did, and answers to what you asked

You went to sleep and let us work on your setup overnight. Here's the whole picture in plain
language, then answers to the questions from your voice notes, then a short list of small things
only you can do. Nothing here is fragile. Take your time.

---

## The short version

Your business app (BGM Office) is now fully moved to its new home, working, and safer than it
was. Your assistant "Amber" was quietly broken — it's fixed now, and we taught it your actual
weekly routine so it should stop being slow and annoying. You do NOT need to buy anything or
switch to a new tool. You already have what those people are describing — it just needed
finishing.

---

## What we fixed on BGM Office (your app)

- **The move to the new system is done.** Your app had been half-moved to the new setup and left
  in a broken state. We finished it. It's live and working, and all your real data (clients,
  instructors, invoices) is in it.
- **We closed a serious privacy hole.** Your database had been left open in a way that could have
  let outsiders read your client info and logins. It's now locked down. Your app was not
  affected — only the leak was closed.
- **We tightened your security** (rotated a secret key that had been exposed, cleaned up old
  leftover files) and wrote up a plain-language improvement plan (in your project as ROADMAP.md).

## What we did with Amber (your assistant)

First, the thing worth knowing: **Amber IS Claude.** It's not a separate product or a person —
it's the same AI, running with an instruction file that gives it the "Amber" personality and
your weekly routine. When it "takes over your computer and makes the reports," that's Claude
following those instructions.

- **Amber was broken and you didn't know.** It was still pointing at your old, dead server, so
  anything it tried to do with BGM Office was failing. Fixed and tested — it logs in fine now.
- **We protected your passwords.** Your Shiftboard and USAePay logins were sitting in plain text
  inside Amber's instruction file. We moved them into a private, protected file so they can't
  leak.
- **We taught Amber your real routine.** Using the old training screen-recording you mentioned,
  we wrote the exact steps into Amber's instructions — which Shiftboard report, how the
  spreadsheet is set up, the billing reconciliation, and your reminder-text wording. This is the
  fix for "slow and annoying until it figures it out" (see below).

---

## Your questions, answered

**"I want to automate my weekly accounting and reminder texts — what do you suggest?"**
You already built this — it's Amber. Pulling the weekly class report, building the who-to-charge
spreadsheet, setting up the recurring credit-card charges for you to verify, and texting
reminders to clients and instructors: that's exactly Amber's weekly routine, and it's already
running. You're not starting from scratch. You're about 80% there and didn't realize it.

**"It's been glitchy, slow, and annoying until it figures it out."**
That's the real problem, and it's fixable — it's not something you have to live with. Amber was
slow because each week it re-learned your screens from scratch, clicking around to find its way.
Now that we've written the exact steps into its instructions (from your training video), it can
just do them instead of hunting. It should get noticeably faster and smoother.

**"Should I not charge the cards automatically at first?"**
Your instinct is exactly right, and it's already set up that way. Amber prepares the recurring
charges for you to review — it does not fire off charges on its own. Keep it like that until
you fully trust it. Good call on your part.

**Everyone's telling me to switch to some new AI tool / buy a Mac mini to automate — should I?**
No. What they're describing is what you already have, and yours runs on a stronger AI than the
local ones they're pushing. Don't rebuild what's working on a shakier setup you can't fix
yourself. The right move is to make Amber more reliable — which is what we just did — not to
start over somewhere new. If someone pitches a specific tool, the test is simple: "if it breaks,
will I know, and can someone fix it?" If not, it's not ready for you.

---

## Small things only you can do (over coffee, no rush)

1. **Push your code to GitHub** — in Cursor: Source Control panel, then Sync/Push. If it asks
   you to sign in to GitHub, click through it.
2. **Tell your assistant to use bgmoffice.vercel.app today** (not bgmoffice.com — that still
   shows the old broken site until we switch the web address over). Same login as always.
3. **Move your web address over** — this needs your Porkbun login, so message Yidy and he'll do
   it with you in a couple of minutes.
4. **Change your admin password** — it's still the default. Do this once the address is switched.
5. **One question for Yidy:** did you ever add clients or invoices on the live website itself, or
   only on your own computer? (This decides whether we grab your old data off the previous host.)

---

You're in good shape. You didn't need to buy anything — you needed the wiring finished, and it
is. Anything confusing, just text.

– Yidy


---

## Update — July 15 (from Yidy, while you were away)

Looked over the intake-form fix you committed (the recruiting Google Form that feeds new client
requests into BGM Office). It's good work. I tightened one part of it:

Your new "which day of the week is this class" detection could get confused when a client's
answer named two different days — e.g. *"Tuesdays 5pm, can start next Monday"* — and it would
give up and mark the class **Flexible** even though it's clearly a Tuesday. It now prefers the
recurring day (the one written as a plural, "Tuesdays") and only falls back to Flexible when the
answer is genuinely ambiguous. I tested it against a batch of realistic answers and it's solid.

Nothing for you to do — new intake entries will just fill in the day more often now. It's
committed on your laptop but not pushed yet; it'll go up next time you Sync/Push (or when we do
the web-address switch together).

– Yidy
