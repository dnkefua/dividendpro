// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {VerifiedArbitrageExecutor} from "../VerifiedArbitrageExecutor.sol";
import {
    MockERC20,
    MockRouter,
    NonCompliantERC20,
    ReentrantOwner,
    ReentrantRouter,
    ResetRequiredERC20
} from "./Mocks.sol";

/// @notice Behavioural tests for the executor.
///
/// The existing `tests/mev-contract.test.ts` greps the Solidity source for
/// specific `require` strings. That catches a deleted guard but proves nothing
/// about runtime behaviour — a guard can be present and still be bypassable.
/// Everything here executes the contract.
///
/// The properties under test, in priority order:
///   1. Value cannot leave the contract to a non-allowlisted address, by ANY path.
///   2. The 24-hour allowlist delay cannot be shortened, skipped, or waited out
///      by seizing ownership.
///   3. A losing trade cannot be left on chain.
///   4. Reentrancy is blocked.
contract VerifiedArbitrageExecutorTest is Test {
    VerifiedArbitrageExecutor internal executor;
    MockERC20 internal tokenIn;
    MockERC20 internal tokenOut;
    MockRouter internal routerBuy;
    MockRouter internal routerSell;

    address internal owner = address(0xA11CE);
    address internal attacker = address(0xBAD);
    address internal recipient = address(0xF00D);

    uint256 internal constant AMOUNT_IN = 1_000e18;
    uint256 internal constant MIN_PROFIT = 1e18;
    uint256 internal constant CAP = 10_000e18;

    function setUp() public {
        // Start well past the epoch so `block.timestamp + 24 hours` is meaningful
        // and the default timestamp of 1 cannot mask an ordering bug.
        vm.warp(1_800_000_000);

        executor = new VerifiedArbitrageExecutor(owner);
        tokenIn = new MockERC20("IN", 18);
        tokenOut = new MockERC20("OUT", 18);

        // Buy leg pays 2 OUT per IN; sell leg pays 0.6 IN per OUT.
        // Round trip: 1000 -> 2000 -> 1200, i.e. +200 IN gross.
        routerBuy = new MockRouter(2, 1);
        routerSell = new MockRouter(6, 10);

        tokenOut.mint(address(routerBuy), 1_000_000e18);
        tokenIn.mint(address(routerSell), 1_000_000e18);
        tokenIn.mint(address(executor), AMOUNT_IN);

        vm.startPrank(owner);
        executor.proposeRouter(address(routerBuy));
        executor.proposeRouter(address(routerSell));
        executor.proposeRecipient(recipient);
        executor.setMaxAmountIn(address(tokenIn), CAP);
        vm.stopPrank();

        // Serve the allowlist delay once, so the default state is "ready".
        // Tests that care about the delay re-propose and assert explicitly.
        vm.warp(block.timestamp + executor.ALLOWLIST_DELAY());
    }

    function _params()
        internal
        view
        returns (VerifiedArbitrageExecutor.ArbitrageParams memory params)
    {
        address[] memory buyPath = new address[](2);
        buyPath[0] = address(tokenIn);
        buyPath[1] = address(tokenOut);
        address[] memory sellPath = new address[](2);
        sellPath[0] = address(tokenOut);
        sellPath[1] = address(tokenIn);

        params = VerifiedArbitrageExecutor.ArbitrageParams({
            executionId: keccak256("execution-1"),
            tokenIn: address(tokenIn),
            amountIn: AMOUNT_IN,
            routerBuy: address(routerBuy),
            routerSell: address(routerSell),
            buyPath: buyPath,
            sellPath: sellPath,
            minProfit: MIN_PROFIT,
            recipient: recipient,
            deadline: block.timestamp + 1 hours
        });
    }

    // ── Happy path ───────────────────────────────────────────────────────────

    function test_profitableRouteSendsOnlyProfitToRecipient() public {
        vm.prank(owner);
        uint256 profit = executor.executeArbitrage(_params());

        assertEq(profit, 200e18, "gross profit");
        assertEq(tokenIn.balanceOf(recipient), 200e18, "recipient receives profit");
        // Principal must stay behind for the next execution, never be swept out.
        assertEq(tokenIn.balanceOf(address(executor)), AMOUNT_IN, "principal retained");
        assertEq(tokenOut.balanceOf(address(executor)), 0, "no intermediate dust");
    }

    function test_approvalsAreZeroedAfterExecution() public {
        vm.prank(owner);
        executor.executeArbitrage(_params());
        // A lingering approval is standing permission for a compromised router
        // to drain the contract later.
        assertEq(tokenIn.allowance(address(executor), address(routerBuy)), 0);
        assertEq(tokenOut.allowance(address(executor), address(routerSell)), 0);
    }

    // ── Property 1: value cannot reach a non-allowlisted address ─────────────

    function test_executeRejectsNonAllowlistedRecipient() public {
        VerifiedArbitrageExecutor.ArbitrageParams memory params = _params();
        params.recipient = attacker;
        vm.prank(owner);
        vm.expectRevert("RECIPIENT_NOT_ALLOWED");
        executor.executeArbitrage(params);
    }

    /// The finding that motivated this change: `recoverToken` was reachable by
    /// anything able to use the signing key, and had no recipient constraint.
    function test_recoverTokenRejectsNonAllowlistedRecipient() public {
        vm.prank(owner);
        vm.expectRevert("RECIPIENT_NOT_ALLOWED");
        executor.recoverToken(address(tokenIn), attacker, AMOUNT_IN);
        assertEq(tokenIn.balanceOf(attacker), 0, "attacker drained nothing");
    }

    function test_recoverTokenSucceedsToAllowlistedRecipient() public {
        vm.prank(owner);
        executor.recoverToken(address(tokenIn), recipient, AMOUNT_IN);
        assertEq(tokenIn.balanceOf(recipient), AMOUNT_IN);
    }

    /// Ownership is not an escape hatch: seizing the key still leaves the
    /// attacker facing the full delay on any address they control.
    /// Seizing ownership is itself timelocked. Without this the attacker takes
    /// the owner role in one block, after which the legitimate owner can no
    /// longer revoke anything — and the allowlist delay degrades from a defence
    /// into a waiting period the attacker simply sits through.
    function test_ownershipTransferIsTimelocked() public {
        vm.prank(owner);
        executor.startOwnershipTransfer(attacker);

        vm.prank(attacker);
        vm.expectRevert("OWNERSHIP_TIMELOCKED");
        executor.acceptOwnership();

        vm.warp(block.timestamp + executor.ALLOWLIST_DELAY() - 1);
        vm.prank(attacker);
        vm.expectRevert("OWNERSHIP_TIMELOCKED");
        executor.acceptOwnership();

        assertEq(executor.owner(), owner, "owner is unchanged for the whole window");
    }

    /// The control that makes the ownership delay useful: an owner who sees an
    /// unexpected transfer can withdraw it before it matures.
    function test_ownershipTransferCanBeCancelledWithinTheWindow() public {
        vm.prank(owner);
        executor.startOwnershipTransfer(attacker);

        vm.prank(owner);
        executor.cancelOwnershipTransfer();
        assertEq(executor.pendingOwner(), address(0));

        vm.warp(block.timestamp + executor.ALLOWLIST_DELAY() + 1);
        vm.prank(attacker);
        vm.expectRevert("NOT_PENDING_OWNER");
        executor.acceptOwnership();
        assertEq(executor.owner(), owner);
    }

    function test_ownershipSeizureStillFacesTheAllowlistDelay() public {
        vm.prank(owner);
        executor.startOwnershipTransfer(attacker);
        vm.warp(block.timestamp + executor.ALLOWLIST_DELAY());
        vm.prank(attacker);
        executor.acceptOwnership();
        assertEq(executor.owner(), attacker);

        vm.startPrank(attacker);
        vm.expectRevert("RECIPIENT_NOT_ALLOWED");
        executor.recoverToken(address(tokenIn), attacker, AMOUNT_IN);

        executor.proposeRecipient(attacker);
        vm.expectRevert("RECIPIENT_NOT_ALLOWED");
        executor.recoverToken(address(tokenIn), attacker, AMOUNT_IN);

        // One second short of the delay is still denied.
        vm.warp(block.timestamp + executor.ALLOWLIST_DELAY() - 1);
        vm.expectRevert("RECIPIENT_NOT_ALLOWED");
        executor.recoverToken(address(tokenIn), attacker, AMOUNT_IN);
        vm.stopPrank();

        assertEq(tokenIn.balanceOf(attacker), 0, "funds survive the full window");
    }

    /// `executionId` is the indexed key off-chain reconciliation matches an
    /// `ArbitrageExecuted` event back to. If it can repeat, settlement can be
    /// attributed to the wrong decision.
    function test_executionIdCannotBeReplayed() public {
        // `_params()` always carries the same executionId, so a second
        // otherwise-valid execution must be rejected on the id alone.
        vm.prank(owner);
        executor.executeArbitrage(_params());
        assertTrue(executor.consumedExecutionIds(keccak256("execution-1")));

        vm.prank(owner);
        vm.expectRevert("EXECUTION_ID_REUSED");
        executor.executeArbitrage(_params());
    }

    /// A call to an address with no code returns success with empty returndata,
    /// which `SafeToken` otherwise accepts as a USDT-style silent success — so
    /// recovery would emit a TokenRecovered event having moved nothing.
    function test_recoverTokenRejectsANonContractToken() public {
        vm.prank(owner);
        vm.expectRevert("TOKEN_NOT_CONTRACT");
        executor.recoverToken(address(0xDEAD), recipient, 1);
    }

    // ── Property 2: the delay is real and revocation is immediate ────────────

    /// The delay block previously covered recipients only; routers carry the
    /// same risk, since an attacker-controlled router sees the principal.
    function test_freshlyProposedRouterIsNotImmediatelyUsable() public {
        MockRouter fresh = new MockRouter(2, 1);
        vm.prank(owner);
        executor.proposeRouter(address(fresh));
        assertFalse(executor.isRouterActive(address(fresh)));

        vm.warp(block.timestamp + executor.ALLOWLIST_DELAY() - 1);
        assertFalse(executor.isRouterActive(address(fresh)), "denied one second short");

        vm.warp(block.timestamp + 1);
        assertTrue(executor.isRouterActive(address(fresh)), "usable once matured");

        vm.prank(owner);
        executor.revokeRouter(address(fresh));
        assertFalse(executor.isRouterActive(address(fresh)), "revocation is immediate");
    }

    function test_freshlyProposedRecipientIsNotImmediatelyUsable() public {
        address fresh = address(0xC0FFEE);
        vm.prank(owner);
        executor.proposeRecipient(fresh);
        assertFalse(executor.isRecipientActive(fresh));

        vm.warp(block.timestamp + executor.ALLOWLIST_DELAY() - 1);
        assertFalse(executor.isRecipientActive(fresh), "denied one second early");

        vm.warp(block.timestamp + 1);
        assertTrue(executor.isRecipientActive(fresh), "active exactly at the boundary");
    }

    /// Re-proposing must restart the clock, never shorten a pending window.
    function test_reproposingRestartsTheDelay() public {
        address fresh = address(0xC0FFEE);
        vm.prank(owner);
        executor.proposeRecipient(fresh);

        vm.warp(block.timestamp + 23 hours);
        vm.prank(owner);
        executor.proposeRecipient(fresh);

        vm.warp(block.timestamp + 1 hours + 1);
        assertFalse(executor.isRecipientActive(fresh), "clock restarted, not resumed");
    }

    function test_revocationIsImmediate() public {
        assertTrue(executor.isRecipientActive(recipient));
        vm.prank(owner);
        executor.revokeRecipient(recipient);
        assertFalse(executor.isRecipientActive(recipient), "revoked in the same block");

        vm.prank(owner);
        vm.expectRevert("RECIPIENT_NOT_ALLOWED");
        executor.executeArbitrage(_params());
    }

    function test_revokedRouterHaltsExecutionImmediately() public {
        vm.prank(owner);
        executor.revokeRouter(address(routerSell));
        vm.prank(owner);
        vm.expectRevert("ROUTER_NOT_ALLOWED");
        executor.executeArbitrage(_params());
    }

    function test_allowlistDelayIsTwentyFourHours() public view {
        assertEq(executor.ALLOWLIST_DELAY(), 24 hours);
    }

    // ── Property 3: no losing trade can land ─────────────────────────────────

    function test_unprofitableRouteReverts() public {
        // Sell leg now pays 0.4 IN per OUT: 1000 -> 2000 -> 800, a loss.
        routerSell.setRate(4, 10);
        vm.prank(owner);
        vm.expectRevert("INSUFFICIENT_OUTPUT_AMOUNT");
        executor.executeArbitrage(_params());
        assertEq(tokenIn.balanceOf(address(executor)), AMOUNT_IN, "principal untouched");
    }

    /// Profit that is positive but below `minProfit` must also revert — the
    /// floor is the whole point of the gate.
    function test_profitBelowMinimumReverts() public {
        VerifiedArbitrageExecutor.ArbitrageParams memory params = _params();
        params.minProfit = 500e18; // achievable profit is 200e18
        vm.prank(owner);
        vm.expectRevert("INSUFFICIENT_OUTPUT_AMOUNT");
        executor.executeArbitrage(params);
    }

    /// Fuzz the sell rate across loss and profit. The contract must either
    /// revert or leave the executor's principal intact plus a profit that
    /// cleared the floor — never anything in between.
    function testFuzz_neverSettlesBelowTheProfitFloor(uint256 sellNumerator) public {
        sellNumerator = bound(sellNumerator, 1, 20);
        routerSell.setRate(sellNumerator, 10);

        uint256 balanceBefore = tokenIn.balanceOf(address(executor));
        vm.prank(owner);
        try executor.executeArbitrage(_params()) returns (uint256 profit) {
            assertGe(profit, MIN_PROFIT, "settled profit cleared the floor");
            assertEq(tokenIn.balanceOf(address(executor)), balanceBefore, "principal intact");
            assertEq(tokenIn.balanceOf(recipient), profit, "profit went to the recipient");
        } catch {
            assertEq(tokenIn.balanceOf(address(executor)), balanceBefore, "reverted cleanly");
            assertEq(tokenIn.balanceOf(recipient), 0);
        }
    }

    // ── Property 4: reentrancy ───────────────────────────────────────────────

    /// A malicious router re-entering directly is stopped by `onlyOwner`, not by
    /// `nonReentrant` — the router is not the owner, and `onlyOwner` is declared
    /// first. Access control is therefore the operative reentrancy defence here.
    function test_reentrantRouterIsBlockedByAccessControl() public {
        ReentrantRouter malicious = new ReentrantRouter();
        vm.startPrank(owner);
        executor.proposeRouter(address(malicious));
        vm.warp(block.timestamp + executor.ALLOWLIST_DELAY());
        vm.stopPrank();

        VerifiedArbitrageExecutor.ArbitrageParams memory params = _params();
        params.routerBuy = address(malicious);
        params.deadline = block.timestamp + 1 hours;
        malicious.arm(
            address(executor),
            abi.encodeCall(VerifiedArbitrageExecutor.executeArbitrage, (params))
        );

        vm.prank(owner);
        vm.expectRevert("NOT_OWNER");
        executor.executeArbitrage(params);
        assertEq(tokenIn.balanceOf(address(executor)), AMOUNT_IN, "principal intact");
    }

    /// The `nonReentrant` guard is only reachable when the re-entrant call comes
    /// from the owner itself, which requires a contract owner. Production uses an
    /// EOA (the KMS-derived signer), so this is defence in depth — but it must
    /// still hold, since the owner could later become a multisig or timelock.
    function test_nonReentrantBlocksOwnerLevelReentry() public {
        ReentrantOwner maliciousOwner = new ReentrantOwner();
        ReentrantRouter malicious = new ReentrantRouter();

        // Hand ownership to a contract that will re-enter. Ownership transfer
        // is timelocked, so this has to mature before it can be accepted.
        vm.prank(owner);
        executor.startOwnershipTransfer(address(maliciousOwner));
        vm.warp(block.timestamp + executor.ALLOWLIST_DELAY());
        vm.prank(address(maliciousOwner));
        executor.acceptOwnership();

        vm.startPrank(address(maliciousOwner));
        executor.proposeRouter(address(malicious));
        vm.warp(block.timestamp + executor.ALLOWLIST_DELAY());
        vm.stopPrank();

        VerifiedArbitrageExecutor.ArbitrageParams memory params = _params();
        params.routerBuy = address(malicious);
        params.deadline = block.timestamp + 1 hours;

        maliciousOwner.configure(
            address(executor),
            abi.encodeCall(VerifiedArbitrageExecutor.executeArbitrage, (params))
        );
        // Router bounces the re-entry back through the owner, so the inner call
        // clears onlyOwner and lands on the reentrancy guard.
        malicious.arm(address(maliciousOwner), abi.encodeCall(ReentrantOwner.reenter, ()));

        vm.expectRevert("REENTRANT");
        maliciousOwner.start();
        assertEq(tokenIn.balanceOf(address(executor)), AMOUNT_IN, "principal intact");
    }

    // ── Notional cap ─────────────────────────────────────────────────────────

    function test_amountAboveCapReverts() public {
        vm.prank(owner);
        executor.setMaxAmountIn(address(tokenIn), AMOUNT_IN - 1);
        vm.prank(owner);
        vm.expectRevert("AMOUNT_ABOVE_CAP");
        executor.executeArbitrage(_params());
    }

    /// An unset cap must deny rather than default to unlimited. A token nobody
    /// has deliberately sized should not be tradeable.
    function test_tokenWithNoCapIsDenied() public {
        MockERC20 unlisted = new MockERC20("UNLISTED", 18);
        VerifiedArbitrageExecutor.ArbitrageParams memory params = _params();
        params.tokenIn = address(unlisted);
        params.buyPath[0] = address(unlisted);
        params.sellPath[1] = address(unlisted);
        vm.prank(owner);
        vm.expectRevert("AMOUNT_ABOVE_CAP");
        executor.executeArbitrage(params);
    }

    // ── Access control ───────────────────────────────────────────────────────

    function test_onlyOwnerCanExecuteOrAdminister() public {
        vm.startPrank(attacker);
        vm.expectRevert("NOT_OWNER");
        executor.executeArbitrage(_params());
        vm.expectRevert("NOT_OWNER");
        executor.recoverToken(address(tokenIn), recipient, 1);
        vm.expectRevert("NOT_OWNER");
        executor.proposeRecipient(attacker);
        vm.expectRevert("NOT_OWNER");
        executor.proposeRouter(attacker);
        vm.expectRevert("NOT_OWNER");
        executor.setMaxAmountIn(address(tokenIn), CAP);
        vm.expectRevert("NOT_OWNER");
        executor.revokeRecipient(recipient);
        vm.stopPrank();
    }

    function test_ownershipTransferRequiresExplicitAcceptance() public {
        vm.prank(owner);
        executor.startOwnershipTransfer(attacker);
        // Still the old owner until accepted — a mistyped address is recoverable.
        assertEq(executor.owner(), owner);

        vm.prank(address(0xDEAD));
        vm.expectRevert("NOT_PENDING_OWNER");
        executor.acceptOwnership();
    }

    // ── Parameter validation ─────────────────────────────────────────────────

    function test_expiredDeadlineReverts() public {
        VerifiedArbitrageExecutor.ArbitrageParams memory params = _params();
        params.deadline = block.timestamp - 1;
        vm.prank(owner);
        vm.expectRevert("DEADLINE");
        executor.executeArbitrage(params);
    }

    function test_identicalRoutersRejected() public {
        VerifiedArbitrageExecutor.ArbitrageParams memory params = _params();
        params.routerSell = params.routerBuy;
        vm.prank(owner);
        vm.expectRevert("IDENTICAL_ROUTERS");
        executor.executeArbitrage(params);
    }

    function test_disconnectedPathRejected() public {
        MockERC20 other = new MockERC20("OTHER", 18);
        VerifiedArbitrageExecutor.ArbitrageParams memory params = _params();
        params.sellPath[0] = address(other);
        vm.prank(owner);
        vm.expectRevert("PATH_DISCONNECTED");
        executor.executeArbitrage(params);
    }

    function test_sellPathMustReturnToInputToken() public {
        MockERC20 other = new MockERC20("OTHER", 18);
        VerifiedArbitrageExecutor.ArbitrageParams memory params = _params();
        params.sellPath[1] = address(other);
        vm.prank(owner);
        vm.expectRevert("SELL_OUTPUT_MISMATCH");
        executor.executeArbitrage(params);
    }

    function test_zeroExecutionIdRejected() public {
        VerifiedArbitrageExecutor.ArbitrageParams memory params = _params();
        params.executionId = bytes32(0);
        vm.prank(owner);
        vm.expectRevert("ZERO_EXECUTION_ID");
        executor.executeArbitrage(params);
    }

    function test_executionBeyondBalanceReverts() public {
        VerifiedArbitrageExecutor.ArbitrageParams memory params = _params();
        params.amountIn = AMOUNT_IN + 1;
        vm.prank(owner);
        vm.expectRevert("INSUFFICIENT_EXECUTOR_BALANCE");
        executor.executeArbitrage(params);
    }

    // ── Non-standard tokens (why SafeToken exists) ───────────────────────────

    /// USDT on both BSC and Ethereum returns no data from transfer/approve. A
    /// plain `IERC20` call against it reverts on ABI decode, so this is a live
    /// concern for the exact token this system is meant to trade.
    function test_handlesTokensThatReturnNoData() public {
        NonCompliantERC20 quiet = new NonCompliantERC20("QUIET", 18);
        MockRouter buy = new MockRouter(2, 1);
        MockRouter sell = new MockRouter(6, 10);
        tokenOut.mint(address(buy), 1_000_000e18);
        quiet.mint(address(sell), 1_000_000e18);
        quiet.mint(address(executor), AMOUNT_IN);

        vm.startPrank(owner);
        executor.proposeRouter(address(buy));
        executor.proposeRouter(address(sell));
        executor.setMaxAmountIn(address(quiet), CAP);
        vm.warp(block.timestamp + executor.ALLOWLIST_DELAY());
        vm.stopPrank();

        VerifiedArbitrageExecutor.ArbitrageParams memory params = _params();
        params.tokenIn = address(quiet);
        params.routerBuy = address(buy);
        params.routerSell = address(sell);
        params.buyPath[0] = address(quiet);
        params.sellPath[1] = address(quiet);
        params.deadline = block.timestamp + 1 hours;

        vm.prank(owner);
        uint256 profit = executor.executeArbitrage(params);
        assertEq(profit, 200e18);
        assertEq(quiet.balanceOf(recipient), 200e18);
    }

    /// The other half of `forceApprove`: tokens that refuse a non-zero-to-
    /// non-zero approval change.
    function test_handlesTokensRequiringApprovalReset() public {
        ResetRequiredERC20 strict = new ResetRequiredERC20("STRICT", 18);
        MockRouter buy = new MockRouter(2, 1);
        MockRouter sell = new MockRouter(6, 10);
        tokenOut.mint(address(buy), 1_000_000e18);
        strict.mint(address(sell), 1_000_000e18);
        strict.mint(address(executor), AMOUNT_IN * 2);

        vm.startPrank(owner);
        executor.proposeRouter(address(buy));
        executor.proposeRouter(address(sell));
        executor.setMaxAmountIn(address(strict), CAP);
        vm.warp(block.timestamp + executor.ALLOWLIST_DELAY());
        vm.stopPrank();

        VerifiedArbitrageExecutor.ArbitrageParams memory params = _params();
        params.tokenIn = address(strict);
        params.routerBuy = address(buy);
        params.routerSell = address(sell);
        params.buyPath[0] = address(strict);
        params.sellPath[1] = address(strict);
        params.deadline = block.timestamp + 1 hours;

        // Execute twice: the second call is the one that would fail if a stale
        // non-zero approval were left behind by the first.
        vm.prank(owner);
        executor.executeArbitrage(params);
        params.executionId = keccak256("execution-2");
        vm.prank(owner);
        executor.executeArbitrage(params);
        assertEq(strict.balanceOf(recipient), 400e18);
    }
}
