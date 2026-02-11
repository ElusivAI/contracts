# Elusiv Contracts — Deep Review

Review of **ElusivToken**, **ElusivAccessPass**, **ElusivResearchDesk**, **ElusivContributionDesk**, and **ElusivCommunityPool** for security, correctness, and best-practice issues.

---

## 1. ElusivToken (ERC20)

**File:** `contracts/ElusivToken.sol`

### Summary
Fixed-supply ERC20, full supply minted to treasury in constructor. No mint/pause/blacklist. Uses OpenZeppelin ERC20 + Ownable.

### Findings

| Severity | Issue | Recommendation |
|----------|--------|----------------|
| **Low** | **Ownable has no use** — No owner-only functions; owner cannot mint or change parameters. | **Addressed:** `Ownable` removed from ElusivToken. |
| **Info** | **Treasury must accept mint** — If `treasury` is a contract that reverts on `receive()`/ERC20 `transfer`, deployment fails. | **Addressed:** Documented in contract NatSpec and CONTRACT_NOTES.md. |

### Positive
- Fixed supply, no extra mint path.
- Solidity 0.8.x overflow checks.
- Simple, minimal attack surface.

---

## 2. ElusivAccessPass (NFT)

**File:** `contracts/ElusivAccessPass.sol`

### Summary
ERC721 paid mint, max supply, promos/affiliates, optional ELUSIV token rewards. Uses ReentrancyGuard on payable and withdraw paths.

### Findings

| Severity | Issue | Recommendation |
|----------|--------|----------------|
| **High** | **Test expects `MintLimitReached` but contract never reverts with it** — `MAX_PER_WALLET = type(uint256).max` and there is no check on `_mintedBy[msg.sender]`. The test "enforces minting rules" expects the second user mint to revert with `MintLimitReached`. | Either enforce a real per-wallet cap and revert with `MintLimitReached` when `_mintedBy[msg.sender] >= MAX_PER_WALLET`, or change the test to match “no per-wallet limit” and remove/repurpose the error. |
| **Medium** | **Payment order: affiliate then treasury** — In `_distributeMintPayment`, affiliate is paid first, then treasury. If affiliate is a contract that reverts, entire mint reverts (including treasury payment). | Acceptable if affiliates are trusted; otherwise consider documenting that malicious affiliate can DoS a mint. |
| **Medium** | **Token reward from contract balance** — Promo token reward is sent from `address(this)`. If owner has not funded the contract, `TokenRewardsUnavailable` reverts and the whole mint fails. | Document that contract must hold enough ELUSIV for active promos, or split “mint + ETH distribution” from “token reward” so mint can succeed and reward can be skipped/claimed later. |
| **Low** | **`setAffiliateSettings` with `rewardsEnabled == false`** — Code allows `tokenAddress == address(0)` when disabling rewards. `elusivToken` is then `IERC20(address(0))`. Later, enabling rewards with a new token is fine. | No change needed; document that when rewards are disabled, token address can be zero. |
| **Low** | **`getPromoCode(bytes32)` for unknown code** — Returns a `Promo` with `affiliate == address(0)`. | Document that callers should treat `affiliate == address(0)` as “no promo”. |
| **Info** | **`receive()` reverts** — Prevents accidental ETH sends; only `publicMint` is intended to receive ETH. | Good. |

### Positive
- `publicMint` and `withdraw` use `nonReentrant`.
- `receive()` reverts (no accidental ETH).
- Affiliate fee capped by `AFFILIATE_FEE_ABSOLUTE_MAX` and `maxAffiliateFeeBps`.
- Self-referral configurable and checked.
- Promo code `bytes32(0)` not allowed in `_setPromoCode`; `publicMint(bytes32(0))` correctly skips promo.
- CEI: state updates then external calls in `_publicMint`; reentrancy guarded.

---

## 3. ElusivResearchDesk

**File:** `contracts/ElusivResearchDesk.sol`

### Summary
Users pay in ELUSIV to submit research requests; owner can complete (no payout) or anyone can submit a completion and requester approves and pays the resolver. Uses ReentrancyGuard on `requestResearch` and `approveCompletion`.

### Findings

| Severity | Issue | Recommendation |
|----------|--------|----------------|
| **High** | **Owner `withdraw` can drain funds needed for approvals** — `withdraw(to, amount)` sends any amount up to contract balance. Unfulfilled requests have payments held in the contract. If owner withdraws too much, a later `approveCompletion` can fail (insufficient balance). | Cap owner withdrawals to “balance minus sum of `payment` for all non-fulfilled requests”, or add a clear “reserved balance” and only allow withdrawing the rest. Document invariants. |
| **Medium** | **`completeRequest` (owner) does not pay resolver** — When owner completes, `req.response` is set and request is fulfilled but no token transfer occurs. Payment remains in the contract. | Intentional “admin resolution”; document. If desired, add an optional path for owner to assign a resolver and transfer payment. |
| **Medium** | **Griefing via `submitCompletion`** — Any address can call `submitCompletion(requestId, documentHash)` for any open request. Requester must call `rejectCompletion` to clear it and allow a new submission; gas cost is on the requester. | Consider rate-limiting per request, or a small stake/cost to submit a completion; or document as accepted griefing cost. |
| **Low** | **No deadline for approval** — After a completion is submitted, requester can wait indefinitely to approve/reject. Resolver’s payment is locked until then. | Optional: add `submittedAt`-based timeout (e.g. auto-reject after N days) or document as-is. |
| **Info** | **CEI and reentrancy** — `requestResearch` does state updates then `safeTransferFrom`; `approveCompletion` is `nonReentrant` and updates state before `safeTransfer`. | Good. |

### Positive
- `requestResearch` and `approveCompletion` protected with `nonReentrant`.
- Pending requests and user indices maintained correctly with swap-and-pop in `_untrackPending`.
- `_getRequest` reverts on invalid `requestId`.
- Only requester can approve/reject; payment goes to the recorded resolver.

---

## 4. ElusivContributionDesk

**File:** `contracts/ElusivContributionDesk.sol`

### Summary
Independent contributions: submitters don’t pay; validators vote; after review period, approved contributions get a reward from the community pool. Pool is a separate contract; desk calls `ICommunityPool(pool).withdraw(contributor, amount)`.

### Findings

| Severity | Issue | Recommendation |
|----------|--------|----------------|
| **High** | **Approved but unpaid if pool has insufficient balance** — In `_checkAndFinalize`, when `approved` and `contrib.rewardAmount > 0`, the code checks `poolBalance >= contrib.rewardAmount`. If the pool has less, the contribution is still set to `Approved` but no tokens are sent and no event or flag records “reward not yet sent”. There is no retry or claim later. | Add a “reward distributed” flag and a `claimReward(contributionId)` for the contributor when pool was short at finalization, or ensure pool is always funded before finalization and document that. |
| **Medium** | **`validatorVote` has no `nonReentrant`** — `validatorVote` can call `_checkAndFinalize`, which calls `ICommunityPool(communityPool).withdraw(contributor, amount)`. The pool’s `withdraw` is `nonReentrant`, so reentrancy into the pool is blocked. Token `safeTransfer` to contributor could still reenter the ContributionDesk. Current logic (status already set to Approved, etc.) appears to prevent double-pay, but the pattern is fragile. | Add `nonReentrant` to `validatorVote` for consistency and defense-in-depth. |
| **Low** | **`submitContribution` has no payment** — Submissions are free; reward is taken from the pool when approved. If pool is empty or underfunded, see “Approved but unpaid” above. | Document that pool must be funded for rewards; consider optional submission fee or stake. |
| **Low** | **`_assignValidators` uses mutable `_nextValidatorIndex`** — It’s updated in `submitContribution` after a view call. Round-robin is deterministic and consistent. | No change; note that validator list changes (add/remove) affect future assignments. |
| **Info** | **Consensus rule** — `approved = contrib.approvalCount >= minValidatorsRequired`; rejections don’t need a threshold. | Clear. |

### Positive
- `finalizeContribution` and `depositToPool` are `nonReentrant`.
- Pool’s `withdraw` is `nonReentrant`, limiting reentrancy from the pool.
- Validator list and vote checks are consistent; only assigned validators can vote; no double vote.

---

## 5. ElusivCommunityPool

**File:** `contracts/ElusivCommunityPool.sol`

### Summary
Holds ELUSIV; only the configured contribution desk (or owner) can withdraw. Used to pay contribution rewards.

### Findings

| Severity | Issue | Recommendation |
|----------|--------|----------------|
| **Low** | **`withdraw` allows `amount == 0` to revert with `InsufficientBalance`** — The revert message says “InsufficientBalance” but the check is `amount == 0`. | Use a dedicated error (e.g. `InvalidAmount`) or require `amount > 0` with a clearer message. |
| **Info** | **`emergencyWithdraw`** — Owner can withdraw any amount; use for emergencies only. | Document and restrict to trusted owner. |

### Positive
- Withdraw restricted to `contributionDesk` or `owner`.
- `withdraw` and `deposit` are `nonReentrant`.
- Zero address and balance checks in place.

---

## 6. Cross-Contract and General

- **Token approval** — All contracts that pull ELUSIV use `SafeERC20`; good for non-standard return values.
- **Reentrancy** — Critical paths use `nonReentrant`; ResearchDesk has been tested with a reentering token mock. Adding `nonReentrant` to ContributionDesk’s `validatorVote` is recommended.
- **Access control** — Owner-only functions are clear; CommunityPool’s dual authorizer (desk + owner) is explicit.
- **Integrations** — Access Pass can be configured with `elusivToken = address(0)` and rewards disabled; ResearchDesk and ContributionDesk require a non-zero token and (for rewards) a funded pool.

---

## 7. Recommended Fixes (Priority) — IMPLEMENTED

1. **Access Pass** — **DONE:** Enforced per-wallet limit (`MAX_PER_WALLET = 1`) and revert with `MintLimitReached` when `_mintedBy[msg.sender] >= MAX_PER_WALLET`. Tests updated to use `getFunction('publicMint()')` for overload disambiguation.
2. **ResearchDesk** — **DONE:** Added `_reservedBalance()` and `reservedBalance()` view; `withdraw` reverts with `ExceedsWithdrawable` if amount exceeds balance minus reserved.
3. **ContributionDesk** — **DONE:** Added `_rewardClaimed`, `claimReward(contributionId)`, and `isRewardClaimed(contributionId)` so contributors can claim when pool was underfunded at finalization.
4. **ContributionDesk** — **DONE:** Added `nonReentrant` to `validatorVote`.
5. **CommunityPool** — **DONE:** Added `InvalidAmount`; `withdraw` and `emergencyWithdraw` revert with it when `amount == 0`.

---

## 8. Summary Table

| Contract            | High | Medium | Low | Info |
|---------------------|------|--------|-----|------|
| ElusivToken         | 0    | 0      | 1   | 1    |
| ElusivAccessPass    | 1    | 2      | 2   | 1    |
| ElusivResearchDesk  | 1    | 2      | 1   | 1    |
| ElusivContributionDesk | 1 | 1      | 2   | 1    |
| ElusivCommunityPool | 0    | 0      | 1   | 1    |

Overall the design is clear and the main risks are: test/contract mismatch on mint limit, reserve balance for research payments, and approved-but-unpaid contribution rewards. Addressing the high and medium items above would significantly harden the system.
