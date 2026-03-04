# Elusiv Contracts

Smart contracts for the Elusiv access pass, ERC‑20 research credit, and on-chain research desk.

## Contents

- `ElusivToken.sol` – fixed-supply ERC‑20 (`ELUSIV`) minted once to a designated treasury.
- `ElusivAccessPass.sol` – ERC‑721 access pass with per-wallet mint limits, paid minting, affiliate/promo support, and configurable treasury.
- `ElusivResearchDesk.sol` – ELUSIV-backed research request queue with bounded queries, efficient pending lookups, and user-driven completion workflow with approval system.
- `ElusivCommunityPool.sol` – ELUSIV token pool that pays rewards for finalized contributions; linked to ContributionDesk.
- `ElusivContributionDesk.sol` – validator-governed desk for independent contributions, voting, and finalization; rewards drawn from CommunityPool.

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
| `AFFILIATE_MAX_FEE_BPS`, `AFFILIATE_DEFAULT_FEE_BPS`, `AFFILIATE_DEFAULT_TOKEN_REWARD`, `AFFILIATE_ALLOW_SELF_REFERRAL`, `AFFILIATE_REWARDS_ENABLED` | Affiliate / promo (Access Pass) |
| `AFFILIATE_SEED_CODE`, `AFFILIATE_SEED_WALLET`, `AFFILIATE_SEED_FEE_BPS`, `AFFILIATE_SEED_TOKEN_REWARD` | Optional seed promo at deploy |
| `RESEARCH_COST_TOKENS`, `RESEARCH_MAX_QUERY_BYTES` | Research desk pricing and bounds |
| `REVIEW_PERIOD`, `MIN_VALIDATORS`, `MAX_VALIDATORS` | ContributionDesk review window and validator bounds |
| `MIN_BALANCE_ETH`, `CONFIRMATIONS`, `ALLOW_MAINNET` | Safety guards for `deploy-simple.js` |

## Development

- **Compile:** `npx hardhat compile`
- **Test:** `npm test` (Hardhat + chai)
- **Coverage:** `npx hardhat coverage`

Artifacts, cache, and coverage outputs are ignored by git to keep the repo clean.

## Deployment

| Script | Purpose |
| --- | --- |
| `scripts/deploy.js` | Hardhat-managed deployments (all five contracts, link Pool ↔ ContributionDesk) |
| `scripts/deploy-local.js` | Local Hardhat: full suite, validators, pool funding, frontend addresses + deployment record |
| `scripts/deploy-testnet.js` | Testnet deploy with optional Etherscan verification; writes frontend addresses |
| `scripts/deploy-simple.js` | RPC + private-key flow with safety checks, optional dry-run; writes deployments + frontend addresses |
| `scripts/deploy-ledger.js` | Ledger signing flow; optional Etherscan verification; writes frontend addresses |

Before production, double-check:

- `NFT_MINT_PRICE_WEI` reflects the intended ETH mint price.
- `TOKEN_TREASURY` and `NFT_TREASURY` are multisig/secured accounts.
- `RESEARCH_MAX_QUERY_BYTES` is sized to your processing limits.
- Ownership of each contract is transferred to hardened governance.
- ABI exports (`node scripts/export-abis.js`) are run after changes for downstream consumers.

## Documentation

- **CONTRACT_REVIEW.md** — Security and correctness review with findings and implemented fixes.
- **CONTRACT_NOTES.md** — Integration and behavior notes (treasury, affiliates, pool funding, admin resolution, griefing).

## Security & Disclosure

- The ELUSIV supply is minted once to `TOKEN_TREASURY`. Secure this key (treasury must accept ERC20; see CONTRACT_NOTES.md).
- Access pass minting enforces per-wallet caps and paid entry; adjust pricing and supply carefully.
- Research desk enforces bounded query lengths and SafeERC20 flows. Supports two completion workflows:
  - **Owner completion**: Contract owner can complete requests directly (backward compatible)
  - **User completion**: Any user can submit document completions; original requester must approve before tokens are transferred to the resolver
- For vulnerabilities, please reach out privately before public disclosure.



