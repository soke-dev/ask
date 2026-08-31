# Confam

**The physical world, on demand.**

Some things cannot be looked up. Whether that road is flooded right now, whether
the queue at that bank is long, whether the shop on that corner is still open at
all. Confam pays somebody who is already standing there to go and look, and
sends back the photograph.

| | |
|---|---|
| Website | https://www.confam.xyz |
| Agent terminal | https://www.confam.xyz/confamagent |
| Tool definitions | https://www.confam.xyz/agent |
| Android | download from the site |
| iOS | TestFlight |
| Escrow contract | [`0x8f93ac1d48f219922cCe1c83AF4c4F718cEB8681`](https://basescan.org/address/0x8f93ac1d48f219922cce1c83af4c4f718ceb8681) on Base |

---

## How a question moves

1. **Somebody asks about a place.** A question, a spot, a bounty and a deadline.
   Asking costs nothing.
2. **Confam AI reads it first** and decides one thing: does anybody actually
   have to go. If a person verified that place recently and the answer still
   holds, you get their photograph straight away and can tip them for it.
3. **Otherwise the job goes out** to people near that place. The bounty is
   locked in an escrow contract on Base the moment the job is created.
4. **Whoever takes it walks there** and submits a photo or a video. It carries
   the time it was taken and how far from the place it was taken, and a
   `keccak256` of the file is written on chain, signed by the person who took
   it.
5. **The asker accepts**, and the escrow releases to the verifier. If they
   query it instead, the money freezes until a reviewer rules — neither side can
   move it in the meantime.

Every answer has a proof page: the hashes, the escrow job, and every
transaction. Hash the file yourself and compare. The server is not in the path
of that check.

## Confam AI

An agent sits in front of every question. It does not answer from its own
knowledge — everything it returns came from a person who stood somewhere, so a
wrong answer is somebody's mistake at a real place rather than a confident
guess. What it decides is whether the question is already answered by evidence
that still stands, or whether it has to spend money sending a human.

Programs can use it too. An agent gets a key, asks questions, and pays the
person who walks there, in USDC on Base.

```
# 1. get a key. in the app: You, then Confam AI, then Create a key

# 2. ask. finding somebody and paying them is handled for you
POST https://www.confam.xyz/agent/ask
     Authorization: Bearer sk_confam_...
     { "question": "Is the gate open?", "place": "Apapa", "bountyNgn": 150 }

     -> { "status": "dispatched", "id": "8f2c...", "costNgn": 150 }
     -> { "status": "answered", "source": "cached" }   if somebody already went

# 3. poll until somebody has been
GET  https://www.confam.xyz/agent/ask/<id>

     -> { "status": "answered", "answer": "Yes, the gate is open.",
          "evidence": ["/media/..."], "evidenceKind": "video",
          "metresFromPlace": 34, "verifier": "musa" }

# 4. accept, and the person who walked there is paid
POST https://www.confam.xyz/agent/ask/<id>/accept
```

`GET /agent` returns the tool definitions, ready to paste into whatever your
agent uses.

Two limits keep a public agent surface from being a way to spend our money:
a job the house funds is between **₦150 and ₦300**, and a key gets **5 of them a
day**. Pass `selfFund: true` and sign the escrow authorisation yourself to go
past either. An answer nobody polls within **15 minutes** is accepted
automatically, so a verifier is never stranded by a program that stopped
calling.

## On chain

`AskEscrow` is a UUPS-upgradeable contract on Base mainnet holding USDC. A job
moves through six states:

```solidity
enum Status { None, Funded, Claimed, Disputed, Released, Refunded }
```

- **`fund`** takes the bounty via EIP-3009 `receiveWithAuthorization`, so the
  asker signs once and never needs ETH for gas.
- **`claim`** records the verifier and the evidence hash, signed by the verifier
  over EIP-712 typed data.
- **`release`** pays the verifier and sends the platform's share to the
  treasury. **`refundExpired`** returns an untaken bounty after its deadline.
- **`dispute`** freezes a job. **`resolve`** is `onlyArbiter` and is the only
  way out of that state — the arbiter can rule, and can do nothing else.
- **`tip`** pays a verifier for an answer that was reused rather than walked.

The owner can upgrade, change the fee, and replace the arbiter, and is therefore
the most dangerous key in the system. It is deliberately not the arbiter, which
lives on a server so the backend can submit rulings.

## Layout

```
app/            the Expo application, expo-router file routes
components/     shared UI
contexts/       app state
utils/          API client, wallet, Privy (native and web split)
constants/      areas, type scale, the legal documents

api/            Node, Express, Postgres
  src/routes/   auth, questions, escrow, evidence, agent, admin, confamagent
  src/          the agent's triage, its wallet, settlement sweep,
                the landing page, the agent terminal, the proof page
  migrations/   plain SQL, applied on boot

contracts/      Foundry. AskEscrow, its tests, and the deploy script
site/           the Vercel project: a proxy, and almost no files
```

The website and the agent terminal are generated by the API rather than being
static files, because both talk to it and the proof pages are rendered per
question out of the database. Vercel forwards to Railway rather than holding a
copy.

## Running it

**The API** needs Postgres and a `.env` (see `api/.env.example`):

```bash
cd api
npm install
npm run migrate
npm run dev            # http://localhost:8080
```

**The app**:

```bash
npm install
npx expo start         # then a, i, or w
```

Set `EXPO_PUBLIC_API_URL` to reach the API. A phone on the same network needs
your machine's LAN address rather than `localhost`.

**The contracts**:

```bash
cd contracts
forge install          # lib/ is not committed
forge test
```

## Deploying

- **API** — Railway, from `api/`. `npm start` runs the migrations then the
  server.
- **Website** — Vercel, root directory `site/`, which forwards the public paths
  to the API. Set `PUBLIC_ORIGIN` on Railway to the domain, or the pages work
  out their own address from a header the client can set.
- **App** — EAS. `production` builds the store bundle, `production-apk` the
  directly installable Android build. The five `EXPO_PUBLIC_*` values live in
  `eas.json`, not in `.env`, because `.env` is gitignored and never reaches the
  build.
- **Admin desk** — `npm run desk` exports the app for the browser against
  production, then `npx vercel deploy dist --prod`.

## A note on what is stored

Evidence is a photograph of a public place, taken deliberately, and it is shown
to the person who asked. Identity documents are held for verification and are
visible only to the team — never to other users, who see a username. The
wallets are non-custodial: the money is the user's, not a balance we owe them.

The full terms and privacy policy are in `constants/legal.ts`, which is the
single source for both the app and the website.
