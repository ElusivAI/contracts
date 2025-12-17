# Elusiv Contracts — Security Review (Manual)

Date: 2025-12-17  
Reviewer: AI-assisted manual review (no automated tooling run)  
Solidity: `pragma solidity ^0.8.24;`

## Scope

In-scope (production):
- `contracts/contracts/ElusivAccessPass.sol`
- `contracts/contracts/ElusivResearchDesk.sol`
- `contracts/contracts/ElusivToken.sol`

In-scope (test/mocks, informational only):
- `contracts/contracts/mocks/ReentrancyMocks.sol`

Out of scope:
- Deployment scripts, Hardhat config, tests, and off-chain systems.

## System overview (high level)

- **`ElusivToken`**: Fixed-supply ERC-20 minted once to a treasury address at deployment.
- **`ElusivAccessPass`**: ERC-721 paid mint with max supply and a per-wallet mint cap, forwarding ETH proceeds to a treasury and (optionally) to an affiliate via promo codes; optional ERC-20 reward payouts to affiliates.
- **`ElusivResearchDesk`**: On-chain queue of research requests paid in an ERC-20 token, fulfilled by the contract owner by storing a response string.

## Summary

No critical vulnerabilities were identified in the reviewed code. The contracts are simple, rely on OpenZeppelin primitives, and include reentrancy protection around the primary payment entrypoints.

Main themes:
- **Observability mismatch**: one event can report token rewards that were not actually transferred.
- **Operational fragility**: ETH-forwarding design can cause paid mints to fail if recipient addresses are non-payable/reverting contracts.
- **Product/centralization risks**: owner has strong control over parameters and fulfillment; users rely on off-chain processes.

## Suggested fixes (quick list)

These are **suggested contract changes** to address the findings. They are included here as implementation guidance only (this audit does not modify any Solidity sources).

- **F-01**: Emit/record the **actual** token reward paid (or emit a separate event indicating reward payment outcome).
- **F-02**: Replace affiliate ETH forwarding with a **pull-payment** model (and optionally do the same for treasury).
- **F-03**: Align `tokenRewardsEnabled` defaults with whether a reward token is configured.
- **F-04**: Decide whether you want cancellability/refunds and whether responses should be stored as full strings vs pointers/hashes.
- **F-05**: Either remove unused `Ownable` from the token or explicitly renounce ownership after deployment.

## Findings table

| ID | Severity | Title | Affected |
| --- | --- | --- | --- |
| F-01 | Medium | `PromoUsed` event can over-report token rewards (even when none were paid) | `ElusivAccessPass` |
| F-02 | Low | ETH forwarding to affiliate/treasury can make mints brittle (recipient can block minting) | `ElusivAccessPass` |
| F-03 | Informational | `tokenRewardsEnabled` can be true while reward token is unset (constructor defaults) | `ElusivAccessPass` |
| F-04 | Informational | Research requests are immutable/uncancellable and store user-provided strings on-chain | `ElusivResearchDesk` |
| F-05 | Informational | Token contract retains an unused `Ownable` role | `ElusivToken` |

## Detailed findings

### F-01 — Medium — `PromoUsed` event can over-report token rewards (even when none were paid)

**Where**
- `ElusivAccessPass._distributeMintPayment()`: `PromoUsed(..., tokenReward)` emits the configured `promo.tokenReward`.

**Issue**
- The event reports `tokenReward` as configured in the promo code, but the ERC-20 transfer only occurs when:
  - `tokenRewardsEnabled == true`
  - `tokenReward > 0`
  - `elusivToken != address(0)`
  - contract has sufficient token balance
- If token rewards are disabled (or token address is unset), the event can still show a non-zero `tokenReward`, which can mislead indexers, analytics, affiliates, and users into believing a reward was paid.

**Impact**
- Off-chain accounting / affiliate dashboards can be incorrect.
- Disputes and operational confusion (e.g., “I was promised X tokens per referral”).

**Recommendation**
- Emit the **actual** reward amount transferred (e.g., `tokenRewardPaid`) and/or a boolean flag indicating whether the reward transfer executed.
- Consider emitting token address in the event for clarity.

**Suggested fix (minimal change, keep event name)**

Reinterpret the existing `tokenReward` event field as “reward **paid**” and emit `0` if rewards are disabled/unconfigured (or if you deliberately skip payout).

```diff
diff --git a/contracts/contracts/ElusivAccessPass.sol b/contracts/contracts/ElusivAccessPass.sol
--- a/contracts/contracts/ElusivAccessPass.sol
+++ b/contracts/contracts/ElusivAccessPass.sol
@@
   function _distributeMintPayment(bytes32 promoCode) internal {
@@
     if (promoCode != bytes32(0)) {
       Promo memory promo = _promos[promoCode];
@@
-      tokenReward = promo.tokenReward;
+      // Treat tokenReward as "reward paid" for observability correctness.
+      tokenReward = 0;
       affiliate = promo.affiliate;
@@
-      if (tokenRewardsEnabled && tokenReward > 0 && address(elusivToken) != address(0)) {
-        if (elusivToken.balanceOf(address(this)) < tokenReward) revert TokenRewardsUnavailable();
-        elusivToken.safeTransfer(affiliate, tokenReward);
-      }
+      if (tokenRewardsEnabled && promo.tokenReward > 0 && address(elusivToken) != address(0)) {
+        if (elusivToken.balanceOf(address(this)) < promo.tokenReward) revert TokenRewardsUnavailable();
+        elusivToken.safeTransfer(affiliate, promo.tokenReward);
+        tokenReward = promo.tokenReward;
+      }
 
       emit PromoUsed(promoCode, msg.sender, affiliate, affiliateAmount, tokenReward);
     }
@@
   }
```

**Suggested fix (stronger, schema-explicit)**

If you can afford an event schema change (breaking for existing indexers), emit explicit fields:
- `rewardToken` (ERC-20 address)
- `tokenRewardConfigured`
- `tokenRewardPaid`
- `rewardPaid` (bool)

This is preferable long-term for analytics and affiliate reconciliation.

---

### F-02 — Low — ETH forwarding to affiliate/treasury can make mints brittle (recipient can block minting)

**Where**
- `ElusivAccessPass._distributeMintPayment()`: sends ETH via low-level `call` to `affiliate` (optional) and `treasury` (always), and `require(...)`s success.

**Issue**
- If either recipient is a contract that reverts on `receive()`/`fallback()`, *all* mints using that promo (affiliate revert) or *all* mints globally (treasury revert) will fail.
- This is not a “theft” vector, but it is an availability/UX risk.

**Impact**
- Paid mints can be unexpectedly blocked by a misconfigured treasury address or an affiliate address that cannot receive ETH.

**Recommendation**
- Prefer a “pull payments” design for at least the affiliate portion:
  - record balances owed, allow affiliates to `withdraw()` later
  - or provide a non-reverting fallback (e.g., route failed affiliate payments to treasury and emit an event)
- Add deployment checklist/documentation requiring `treasury` to be a payable address that accepts ETH.

**Suggested fix (pull payments for affiliates)**

Replace the affiliate ETH transfer with accrual to a mapping and a separate `withdrawAffiliate()` function. This removes the ability for an affiliate contract to brick mints by reverting on `receive()`.

```diff
diff --git a/contracts/contracts/ElusivAccessPass.sol b/contracts/contracts/ElusivAccessPass.sol
--- a/contracts/contracts/ElusivAccessPass.sol
+++ b/contracts/contracts/ElusivAccessPass.sol
@@
 contract ElusivAccessPass is ERC721, Ownable, ReentrancyGuard {
@@
+  mapping(address => uint256) public affiliateEthOwed;
+  event AffiliateWithdrawal(address indexed affiliate, uint256 amount);
@@
   function _distributeMintPayment(bytes32 promoCode) internal {
@@
     if (promoCode != bytes32(0)) {
@@
       affiliateAmount = (msg.value * promo.feeBps) / 10_000;
@@
-      if (affiliateAmount > 0) {
-        (bool sentAffiliate, ) = payable(affiliate).call{ value: affiliateAmount }('');
-        require(sentAffiliate, 'Affiliate transfer failed');
-      }
+      if (affiliateAmount > 0) {
+        affiliateEthOwed[affiliate] += affiliateAmount;
+      }
@@
     }
@@
     uint256 treasuryAmount = msg.value - affiliateAmount;
     (bool sentTreasury, ) = treasury.call{ value: treasuryAmount }('');
     require(sentTreasury, 'Treasury transfer failed');
   }
+
+  function withdrawAffiliate(address payable to) external nonReentrant {
+    uint256 amount = affiliateEthOwed[msg.sender];
+    require(amount > 0, 'Nothing owed');
+    affiliateEthOwed[msg.sender] = 0;
+    (bool sent, ) = to.call{ value: amount }('');
+    require(sent, 'Withdraw failed');
+    emit AffiliateWithdrawal(msg.sender, amount);
+  }
```

**Suggested fix (optional)**

If you also want to eliminate the “treasury can brick minting” risk, use the same pull-payment approach for treasury (accrue and withdraw), at the cost of no longer forwarding ETH immediately per mint.

---

### F-03 — Informational — `tokenRewardsEnabled` can be true while reward token is unset (constructor defaults)

**Where**
- `ElusivAccessPass` constructor sets `tokenRewardsEnabled = true` while `elusivToken` is unset (`address(0)`) and `defaultTokenReward = 0`.

**Issue**
- This is safe given the current logic (no transfer happens unless `tokenReward > 0` and token address is set), but it can confuse operators and off-chain systems (“rewards enabled” but no reward token configured).

**Recommendation**
- Consider defaulting `tokenRewardsEnabled` to `false` until `elusivToken` is configured, or emit an additional event indicating rewards are “configured vs enabled”.

**Suggested fix (align defaults)**

In the constructor, set `tokenRewardsEnabled = false` by default and only enable it after calling `setAffiliateSettings(...)` with a non-zero token address. This prevents “enabled-but-unconfigured” state from the beginning.

---

### F-04 — Informational — Research requests are immutable/uncancellable and store user-provided strings on-chain

**Where**
- `ElusivResearchDesk.requestResearch()` stores `query` on-chain; `completeRequest()` stores `response` on-chain; no cancel/refund function exists.

**Issue**
- Users cannot cancel a request or get refunds via the contract if they change their mind or if off-chain fulfillment fails.
- Queries/responses are permanently stored on-chain (subject to `maxQueryLength` for queries, but not for responses), which may be undesirable for privacy/PII or content moderation.

**Recommendation**
- If desired product-wise, add an explicit policy in docs/UI:
  - no refunds/cancellations
  - do not include sensitive data in queries
- Optionally cap response length (or store only a content hash / IPFS CID).

**Suggested fix (store pointers instead of full responses)**

Replace the on-chain `response` string with an off-chain pointer (e.g., IPFS CID) or a `bytes32` hash, and emit the full response in an event only if desired. This reduces permanent on-chain content storage risk.

---

### F-05 — Informational — Token contract retains an unused `Ownable` role

**Where**
- `ElusivToken` inherits `Ownable` but exposes no owner-only methods.

**Issue**
- Not a security vulnerability, but it creates a “phantom admin” surface from a governance/expectations standpoint.

**Recommendation**
- Consider documenting that ownership is unused, or renouncing ownership after deployment (operational choice).

**Suggested fix**

Either:
- Remove `Ownable` inheritance from `ElusivToken` (cleaner ABI), or
- Add a deployment step to call `renounceOwnership()` once you’re satisfied no owner-only controls are needed.

## Notes / positive observations

- **Reentrancy protection**: `ElusivAccessPass.publicMint` and `ElusivResearchDesk.requestResearch/withdraw` are `nonReentrant`; there are explicit reentrancy mocks suggesting this was considered in testing.
- **Checks-effects-interactions**: `ElusivAccessPass` increments the per-wallet minted count before external calls, but external call failures revert the whole transaction (no stuck partial state).
- **Input bounds**: `ElusivResearchDesk` enforces a query length maximum; `ElusivAccessPass` enforces max supply and per-wallet cap for public minting.


