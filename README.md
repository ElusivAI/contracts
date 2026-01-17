# Elusiv Contracts

Smart contracts for the Elusiv access pass, ERC‑20 research credit, and on-chain research desk.

## Contents

- `ElusivToken.sol` – fixed-supply ERC‑20 (`ELUSIV`) minted once to a designated treasury.
- `ElusivAccessPass.sol` – ERC‑721 access pass with per-wallet mint limits, paid minting, and configurable treasury.
- `ElusivResearchDesk.sol` – ELUSIV-backed research request queue with bounded queries, efficient pending lookups, and user-driven completion workflow with approval system.

## Requirements

- Node 18+
- npm 9+
- Hardhat CLI (`npx hardhat`) – installed via project dev dependencies.

## Setup

```bash
cd contracts
npm install
cp ENV.example .env   # populate with real values
```

Key environment variables:

| Variable | Description |
| --- | --- |
| `HARDHAT_SEPOLIA_RPC_URL` / `HARDHAT_PRIVATE_KEY` | Remote network deployment |
| `TOKEN_TREASURY` | Address receiving the fixed ELUSIV supply |
| `NFT_MAX_SUPPLY`, `NFT_MINT_PRICE_WEI`, `NFT_TREASURY`, `NFT_MINTING_ENABLED` | Access pass configuration |
| `RESEARCH_COST_TOKENS`, `RESEARCH_MAX_QUERY_BYTES` | Research desk pricing and bounds |
| `MIN_BALANCE_ETH`, `CONFIRMATIONS`, `ALLOW_MAINNET` | Safety guards for `deploy-simple.js` |

## Development

- **Compile:** `npx hardhat compile`
- **Test:** `npm test` (Hardhat + chai)
- **Coverage:** `npx hardhat coverage`

Artifacts, cache, and coverage outputs are ignored by git to keep the repo clean.

## Deployment

| Script | Purpose |
| --- | --- |
| `scripts/deploy.js` | Hardhat-managed deployments using configured networks |
| `scripts/deploy-simple.js` | RPC + private-key flow with safety checks, optional dry-run |
| `scripts/seed.js` | Local bootstrap – deploys suite, mints supply, updates frontend addresses |

Before production, double-check:

- `NFT_MINT_PRICE_WEI` reflects the intended ETH mint price.
- `TOKEN_TREASURY` and `NFT_TREASURY` are multisig/secured accounts.
- `RESEARCH_MAX_QUERY_BYTES` is sized to your processing limits.
- Ownership of each contract is transferred to hardened governance.
- ABI exports (`node scripts/export-abis.js`) are run after changes for downstream consumers.

## Security & Disclosure

- The ELUSIV supply is minted once to `TOKEN_TREASURY`. Secure this key or transfer ownership to a multisig.
- Access pass minting enforces per-wallet caps and paid entry; adjust pricing and supply carefully.
- Research desk enforces bounded query lengths and SafeERC20 flows. Supports two completion workflows:
  - **Owner completion**: Contract owner can complete requests directly (backward compatible)
  - **User completion**: Any user can submit document completions; original requester must approve before tokens are transferred to the resolver
- For vulnerabilities, please reach out privately before public disclosure.



