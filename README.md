# ⬡ MotoSwap Liquidity Locker

> Trustless LP token locker for MotoSwap on OP_NET · Permanent burn & timelocked release  
> **v3.0** — Partial unlock · Split locks · NFT receipts · Batch locking · Fee treasury

[![CI](https://github.com/YOUR_USERNAME/motoswap-locker/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR_USERNAME/motoswap-locker/actions)

---

## Repository Structure

```
motoswap-locker/
├── frontend/                  # Vite + React dApp
│   ├── src/
│   │   ├── App.jsx            # Full UI — OP_WALLET connect + lock dashboard
│   │   ├── main.jsx           # React entry point
│   │   └── config.js          # Testnet/mainnet addresses (reads from .env)
│   ├── public/
│   │   └── favicon.svg
│   ├── index.html
│   ├── package.json
│   └── vite.config.js         # Railway PORT-aware config
│
├── contract/                  # AssemblyScript OP_NET contract
│   ├── src/
│   │   └── LiquidityLocker.ts # v3.0 contract source
│   ├── asconfig.json
│   └── package.json
│
├── scripts/
│   └── deploy-contract.js     # Build + deploy to testnet/mainnet
│
├── .github/
│   └── workflows/
│       └── ci.yml             # GitHub Actions — build + lint on every push
│
├── railway.toml               # Railway build + start config
├── nixpacks.toml              # Railway Nixpacks overrides
├── .env.example               # Environment variable template
├── .gitignore
└── package.json               # Root workspace (npm workspaces)
```

---

## Quick Start (Local)

```bash
# 1. Clone
git clone https://github.com/YOUR_USERNAME/motoswap-locker.git
cd motoswap-locker

# 2. Copy env template
cp .env.example frontend/.env.local
# Edit frontend/.env.local and fill in your testnet addresses

# 3. Install deps
cd frontend && npm install

# 4. Run dev server
npm run dev
# → http://localhost:3000
```

---

## Deploy to Railway

### One-time setup

1. Push this repo to GitHub
2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
3. Select your repository
4. Railway auto-detects `railway.toml` and configures the build

### Set environment variables in Railway

Go to your Railway service → **Variables** → add each variable from `.env.example`:

| Variable | Description |
|---|---|
| `VITE_LOCKER_ADDRESS` | Your deployed LiquidityLocker P2OP address |
| `VITE_MOTOSWAP_FACTORY` | MotoSwap Factory testnet address |
| `VITE_MOTOSWAP_ROUTER` | MotoSwap Router testnet address |
| `VITE_MOTOCHEF` | MotoChef testnet address |
| `VITE_PAIR_MOTO_PILL` | MOTO-PILL LP pair address |
| `VITE_PAIR_MOTO_BTC` | MOTO-tBTC LP pair address |
| `VITE_PAIR_PILL_BTC` | PILL-tBTC LP pair address |
| `VITE_TOKEN_MOTO` | MOTO token address |
| `VITE_TOKEN_PILL` | PILL token address |
| `VITE_NETWORK` | `testnet` or `mainnet` |

> **Note:** Railway injects `PORT` automatically — the Vite preview server reads it via `vite.config.js`.

### Deploy

Railway deploys automatically on every push to `main`. To trigger manually:

```bash
git push origin main
```

Your app will be live at `https://YOUR_SERVICE.up.railway.app`

---

## Deploy the Contract to OP_NET Testnet

```bash
# 1. Install contract deps
cd contract && npm install

# 2. Set your wallet private key
export OPNET_PRIVATE_KEY=your_private_key_here

# 3. Get tBTC from faucet
#    https://faucet.opnet.org

# 4. Deploy
node scripts/deploy-contract.js --network testnet
# → Outputs your P2OP contract address
# → Saves to deploy-info.json

# 5. Set VITE_LOCKER_ADDRESS in Railway to the output address

# 6. Call setFactory() as admin (one-time)
opnet contract call \
  --contract YOUR_LOCKER_ADDRESS \
  --method "setFactory(address)" \
  --args "bc1p_MOTOSWAP_FACTORY_TESTNET" \
  --network testnet
```

---

## Contract Interface (v3.0)

| Method | Description |
|---|---|
| `lockPermanent(token, amount, label, tag)` | Burn LP tokens forever |
| `lockTimed(token, amount, unlockBlock, label, tag)` | Lock until block height |
| `unlock(lockId)` | Full release after deadline |
| `unlockPartial(lockId, amount)` | ⭐ Partial release, remainder stays locked |
| `splitLock(lockId, amount)` | ⭐ Split into two independent locks |
| `batchLockTimed(tokens[], amounts[], blocks[], labels[])` | ⭐ Lock up to 10 pairs at once |
| `extendLock(lockId, newBlock)` | Push deadline further |
| `transferLockOwnership(lockId, newOwner)` | Transfer release rights |
| `getLockV2(lockId)` | Full metadata including tag, nonce, parent |

---

## Testnet Resources

- **tBTC Faucet:** https://faucet.opnet.org
- **PILL Faucet:** https://testnet.motoswap.org/faucet
- **MotoSwap Testnet:** https://testnet.motoswap.org
- **OPScan Testnet:** https://testnet.opscan.io
- **OP_NET Docs:** https://docs.opnet.org

---

## Tech Stack

| Layer | Tech |
|---|---|
| Smart Contract | AssemblyScript → WASM · OP_NET runtime · DeployableOP_20 |
| Frontend | React 18 · Vite 5 · OP_WALLET provider |
| Deployment | Railway (frontend) · OP_NET CLI (contract) |
| CI/CD | GitHub Actions |
| Wallet | OP_WALLET browser extension (btc-vision/opwallet) |
