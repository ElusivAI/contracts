# Contract integration and behavior notes

Reference for deployers and integrators. See `CONTRACT_REVIEW.md` for the full security review.

## ElusivToken

- **Treasury at deployment:** The constructor mints the full supply to `treasury`. Use an EOA or a contract that accepts ERC20; if the treasury reverts on transfer (e.g. non-accepting contract), deployment will fail.

## ElusivAccessPass

- **Affiliate payments:** Affiliate is paid first, then treasury. If the affiliate is a contract that reverts on receive, the entire mint reverts (DoS for that promo). Use trusted affiliates or EOAs.
- **Token rewards:** Promo token rewards are sent from the pass contract balance. Ensure the contract holds enough ELUSIV for active promos, or mints using those promos will revert with `TokenRewardsUnavailable`.
- **Rewards disabled:** When `rewardsEnabled` is false, `elusivToken` may be set to `address(0)`. You can later enable rewards by setting a valid token and `rewardsEnabled` true.
- **getPromoCode:** For unknown or disabled codes, the returned `Promo` has `affiliate == address(0)`. Treat that as “no promo”.

## ElusivResearchDesk

- **completeRequest (owner):** Admin-only path. Marks the request fulfilled but does **not** transfer payment to a resolver; tokens stay in the contract. Use for administrative resolutions. For user-driven completions that pay the resolver, use the submitCompletion + approveCompletion flow.
- **submitCompletion griefing:** Any address can submit a completion for any open request. The requester must call `rejectCompletion` to clear it (gas cost on requester). This is an accepted tradeoff; no rate-limiting or stake is enforced.
- **Approval deadline:** There is no timeout for the requester to approve or reject a submitted completion; the resolver’s payment is locked until the requester acts.

## ElusivContributionDesk and ElusivCommunityPool

- **Pool funding:** Approved contributions take their reward from the community pool at finalization. If the pool balance is insufficient, the contribution is still marked Approved but the reward is not sent; the contributor can later call `claimReward(contributionId)` once the pool has been funded.
- **Submissions are free:** Submitting a contribution does not require a payment; rewards are drawn from the pool when approved. Ensure the pool is funded (e.g. via `depositToPool` or direct deposits to the pool) for rewards to be paid or claimable.

## ElusivCommunityPool

- **emergencyWithdraw:** Owner can withdraw any amount. Intended for emergencies only; keep the owner as a trusted multisig or governance contract.
