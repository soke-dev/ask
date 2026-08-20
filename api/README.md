# Ask Nearby — API

The evidence gate and the records behind it. Runs on your laptop for now;
deploys to Railway once the app is ready to point at it.

## Deploy order

Database first, API last. That order matters: the API is useless without a
schema to write into, and deploying it first means a live service failing
every request while you catch up.

### 1. Postgres on Railway — do this now

```
railway login
railway init                     # or `railway link` to an existing project
railway add --database postgres
railway variables                # copy DATABASE_PUBLIC_URL
```

`DATABASE_PUBLIC_URL` is the one that works from your laptop.
`DATABASE_URL` only resolves inside Railway's private network, so it is the
one to switch to at step 3, when the API is living there too.

### 2. API on your laptop — against that database

```
cd api
cp .env.example .env             # paste DATABASE_PUBLIC_URL into DATABASE_URL
npm install
npm run migrate                  # creates every table
npm run dev                      # http://localhost:8080
```

Confirm it: `curl localhost:8080/health` reports `"database": "connected"`.

To point the app at it, put your machine's LAN address — not `localhost`,
which on a phone means the phone — in the Expo app's environment:

```
EXPO_PUBLIC_API_URL=http://192.168.0.10:8080
```

Without that variable the app runs the checks it can do on-device and says
plainly that the rest were not run. Nothing breaks.

### 3. API on Railway — after everything else works

```
railway up
railway variables --set "ANTHROPIC_API_KEY=sk-..."
```

Set `DATABASE_URL` to the private `DATABASE_URL` at this point, and set
`EXPO_PUBLIC_API_URL` in the app to the Railway domain.

**One thing must change before this step.** `STORAGE_DRIVER=disk` writes
evidence to the container filesystem, which Railway wipes on every deploy and
every restart. Evidence would vanish partway through a dispute — exactly when
it matters most. Add an object-store driver (R2, B2 or S3) in `src/storage.ts`
first; the interface is deliberately the small part of S3 they all implement.

## The evidence gate

`POST /evidence/check` — multipart. Fields: `kind` (`photo`|`video`),
`question`, `placeName?`, `taskId?`, `capturedLat/Lng?`, `targetLat/Lng?`,
and one or more `files`.

Returns `{ verdict, checks[], attemptsLeft }` where verdict is `pass`, `warn`
or `fail`.

### What each check does, and what it is allowed to do

| Check | Tier | Measures | Can it block? |
|---|---|---|---|
| `sharpness` | 1 | Variance of the Laplacian, on a 640px greyscale copy | **Yes** |
| `exposure` | 1 | Mean luma and clipped-pixel fraction | **Yes** |
| `duration` | 1 | Clip length via ffprobe | **Yes** |
| `count` | 1 | Number of photos | **Yes** |
| `distance` | 1 | Haversine from the capture to the pin | No — warns only |
| `relevance` | 2 | Vision model: does this plausibly relate to the question | No — warns only |

The split down that last column is the design, not an accident.

**Tier 1 measures the file.** Whether an image is blurred or black is a fact
about the bytes, it is not a matter of opinion, and a verifier sent back to
retake a black photo has lost two minutes.

**Tier 2 interprets the world**, and is therefore never allowed to block. A
wrong "this is irrelevant" costs an honest person the payment for a trip they
actually made — the worst outcome the system can produce. The ceiling is
enforced in `checks/relevance.ts` rather than left to the caller.

`distance` is advisory for the same kind of reason: consumer GPS is routinely
tens of metres out, worse between tall buildings, a market is far bigger than
the point representing it, and someone across the road can see a queue fine.

### Tier 2 does not run after a tier-1 failure

A model call costs real money on every submission. At a ₦500 bounty the fee is
around ₦50, so a few naira per check is a real slice of the margin. There is no
point asking a model what a photo shows when the verifier is being sent back
anyway — most junk is exactly what tier 1 catches, and it dies for free.

## Verifying it

```
npm run checks:try     # synthetic sharp/blurred/dark frames through the gate
```

Prints the measurements and asserts the metric actually separates blur from
sharpness. **Note what this does and does not prove:** it shows the plumbing
works and that the Laplacian discriminates. It does *not* validate the
thresholds — the synthetic scene is far more detailed than a real photo and
scores an order of magnitude higher. Real Lagos street photos will land much
lower, and the numbers in `.env.example` will need moving once you have a week
of genuine submissions to look at. Every threshold is env-tunable for exactly
that reason.

## Layout

```
migrations/     plain SQL, applied in filename order, each in its own transaction
src/config.ts   every threshold, all env-tunable
src/db.ts       pool, BIGINT parsing, transaction helper
src/storage.ts  where evidence goes — disk driver is dev-only
src/checks/     the gate
src/routes/     HTTP
```

Money is stored in kobo as `BIGINT`, never a float — naira has a subunit and
binary floating point cannot hold 0.1 exactly. The client works in whole naira,
so the conversion happens at the API boundary and nowhere else.
