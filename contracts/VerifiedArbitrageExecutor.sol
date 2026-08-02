// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IV2RouterMinimal {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

library SafeToken {
    /// @dev A call to an address with no code returns success with empty
    ///      returndata, and `result.length == 0` is accepted as success for
    ///      USDT-style tokens that return nothing. Without this check the two
    ///      behaviours are indistinguishable, so a transfer to a non-contract
    ///      "succeeds" and emits while moving nothing.
    function requireContract(IERC20Minimal token) internal view {
        require(address(token).code.length > 0, "TOKEN_NOT_CONTRACT");
    }

    function safeTransfer(IERC20Minimal token, address to, uint256 amount) internal {
        requireContract(token);
        (bool success, bytes memory result) = address(token).call(
            abi.encodeCall(IERC20Minimal.transfer, (to, amount))
        );
        require(success && (result.length == 0 || abi.decode(result, (bool))), "TRANSFER_FAILED");
    }

    function forceApprove(IERC20Minimal token, address spender, uint256 amount) internal {
        requireContract(token);
        (bool success, bytes memory result) = address(token).call(
            abi.encodeCall(IERC20Minimal.approve, (spender, amount))
        );
        if (!(success && (result.length == 0 || abi.decode(result, (bool))))) {
            (success, result) = address(token).call(
                abi.encodeCall(IERC20Minimal.approve, (spender, 0))
            );
            require(success && (result.length == 0 || abi.decode(result, (bool))), "APPROVE_RESET_FAILED");
            (success, result) = address(token).call(
                abi.encodeCall(IERC20Minimal.approve, (spender, amount))
            );
            require(success && (result.length == 0 || abi.decode(result, (bool))), "APPROVE_FAILED");
        }
    }
}

/// @notice Owner-operated, atomic V2-to-V2 arbitrage executor.
/// @dev It cannot leave a losing trade on chain: the entire call reverts unless
///      tokenIn profit is at least minProfit. It intentionally supports neither
///      sandwiching nor arbitrary external calls.
contract VerifiedArbitrageExecutor {
    using SafeToken for IERC20Minimal;

    /// @notice Delay before a newly proposed router or recipient becomes usable.
    /// @dev This is the contract's single most important safety property, and it
    ///      is a constant precisely so that a compromised owner key cannot
    ///      shorten it. The threat model is not key theft — the signing key is
    ///      HSM-backed and non-exportable — but key *use*, by anything that can
    ///      reach the signing path. Every route by which value leaves this
    ///      contract (arbitrage profit, and recovery) terminates at an allowlisted
    ///      recipient, so an attacker who cannot add a recipient for 24 hours
    ///      cannot exfiltrate for 24 hours, and the legitimate owner can revoke
    ///      instantly in that window.
    uint256 public constant ALLOWLIST_DELAY = 24 hours;

    address public owner;
    address public pendingOwner;
    /// @dev Timestamp from which `pendingOwner` may accept. 0 means no transfer
    ///      is in flight. Ownership is subject to the same delay as the
    ///      allowlists: without it, two transactions in one block hand an
    ///      attacker the owner role, after which the legitimate owner can no
    ///      longer revoke anything and the 24-hour window stops being a defence
    ///      and becomes a waiting period the attacker simply sits through.
    uint256 public pendingOwnerActiveFrom;
    uint256 private locked = 1;

    /// @dev 0 means denied. Any other value is the timestamp from which the
    ///      address may be used. Additions are delayed; revocations are not.
    mapping(address => uint256) public routerActiveFrom;
    mapping(address => uint256) public recipientActiveFrom;

    /// @notice Per-input-token ceiling on a single execution's `amountIn`.
    /// @dev 0 denies the token outright. This is a risk limit rather than a
    ///      security boundary — raising it cannot move funds on its own, since
    ///      principal never leaves the contract and profit only ever reaches an
    ///      allowlisted recipient — so it is settable without delay.
    mapping(address => uint256) public maxAmountIn;

    /// @dev `executionId` is the indexed key off-chain reconciliation uses to
    ///      match an `ArbitrageExecuted` event back to the decision that caused
    ///      it. Without a uniqueness guard the same id can be emitted more than
    ///      once, and the event stops being a reliable key for settlement.
    mapping(bytes32 => bool) public consumedExecutionIds;

    struct ArbitrageParams {
        bytes32 executionId;
        address tokenIn;
        uint256 amountIn;
        address routerBuy;
        address routerSell;
        address[] buyPath;
        address[] sellPath;
        uint256 minProfit;
        address recipient;
        uint256 deadline;
    }

    event RouterProposed(address indexed router, uint256 activeFrom);
    event RouterRevoked(address indexed router);
    event RecipientProposed(address indexed recipient, uint256 activeFrom);
    event RecipientRevoked(address indexed recipient);
    event MaxAmountInUpdated(address indexed token, uint256 previousAmount, uint256 newAmount);
    event OwnershipTransferStarted(address indexed owner, address indexed pendingOwner);
    event OwnershipTransferCancelled(address indexed cancelledPendingOwner);
    event TokenRecovered(address indexed token, address indexed to, uint256 amount);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ArbitrageExecuted(
        bytes32 indexed executionId,
        address indexed profitToken,
        address indexed recipient,
        uint256 amountIn,
        uint256 profit
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    modifier nonReentrant() {
        require(locked == 1, "REENTRANT");
        locked = 2;
        _;
        locked = 1;
    }

    constructor(address initialOwner) {
        require(initialOwner != address(0), "ZERO_OWNER");
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    /// @notice True once an address has been proposed and its delay has elapsed.
    function isRouterActive(address router) public view returns (bool) {
        uint256 activeFrom = routerActiveFrom[router];
        return activeFrom != 0 && block.timestamp >= activeFrom;
    }

    function isRecipientActive(address recipient) public view returns (bool) {
        uint256 activeFrom = recipientActiveFrom[recipient];
        return activeFrom != 0 && block.timestamp >= activeFrom;
    }

    /// @dev Re-proposing an already-pending or active router restarts its delay,
    ///      so a proposal can never be used to shorten an existing one.
    function proposeRouter(address router) external onlyOwner {
        require(router != address(0), "ZERO_ROUTER");
        uint256 activeFrom = block.timestamp + ALLOWLIST_DELAY;
        routerActiveFrom[router] = activeFrom;
        emit RouterProposed(router, activeFrom);
    }

    /// @notice Immediate — withdrawing trust must never wait on a timer.
    function revokeRouter(address router) external onlyOwner {
        routerActiveFrom[router] = 0;
        emit RouterRevoked(router);
    }

    function proposeRecipient(address recipient) external onlyOwner {
        require(recipient != address(0), "ZERO_RECIPIENT");
        uint256 activeFrom = block.timestamp + ALLOWLIST_DELAY;
        recipientActiveFrom[recipient] = activeFrom;
        emit RecipientProposed(recipient, activeFrom);
    }

    /// @notice Immediate, for the same reason as `revokeRouter`.
    function revokeRecipient(address recipient) external onlyOwner {
        recipientActiveFrom[recipient] = 0;
        emit RecipientRevoked(recipient);
    }

    function setMaxAmountIn(address token, uint256 amount) external onlyOwner {
        require(token != address(0), "ZERO_TOKEN");
        uint256 previousAmount = maxAmountIn[token];
        maxAmountIn[token] = amount;
        emit MaxAmountInUpdated(token, previousAmount, amount);
    }

    function startOwnershipTransfer(address newOwner) external onlyOwner {
        require(newOwner != address(0), "ZERO_OWNER");
        pendingOwner = newOwner;
        pendingOwnerActiveFrom = block.timestamp + ALLOWLIST_DELAY;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    /// @notice Immediate, like every other revocation here. This is the control
    ///         that makes the ownership delay useful: an owner who sees an
    ///         unexpected `OwnershipTransferStarted` can cancel it within the
    ///         window. Previously a pending transfer could never be withdrawn.
    function cancelOwnershipTransfer() external onlyOwner {
        address cancelled = pendingOwner;
        pendingOwner = address(0);
        pendingOwnerActiveFrom = 0;
        emit OwnershipTransferCancelled(cancelled);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "NOT_PENDING_OWNER");
        require(
            pendingOwnerActiveFrom != 0 && block.timestamp >= pendingOwnerActiveFrom,
            "OWNERSHIP_TIMELOCKED"
        );
        address previousOwner = owner;
        owner = msg.sender;
        pendingOwner = address(0);
        pendingOwnerActiveFrom = 0;
        emit OwnershipTransferred(previousOwner, msg.sender);
    }

    function executeArbitrage(ArbitrageParams calldata params)
        external
        onlyOwner
        nonReentrant
        returns (uint256 profit)
    {
        require(block.timestamp <= params.deadline, "DEADLINE");
        require(params.executionId != bytes32(0), "ZERO_EXECUTION_ID");
        // Checks-effects-interactions: consumed before any external call, so a
        // re-entrant path cannot replay the same id even if the mutex changes.
        require(!consumedExecutionIds[params.executionId], "EXECUTION_ID_REUSED");
        consumedExecutionIds[params.executionId] = true;
        require(params.amountIn > 0 && params.minProfit > 0, "ZERO_AMOUNT");
        require(params.recipient != address(0), "ZERO_RECIPIENT");
        // Profit leaves the contract at the end of this call, so the recipient is
        // enforced on chain rather than trusted from the server that built the
        // params. A compromised control plane cannot redirect proceeds to an
        // address that was not allowlisted at least ALLOWLIST_DELAY ago.
        require(isRecipientActive(params.recipient), "RECIPIENT_NOT_ALLOWED");
        // Per-token notional ceiling, enforced on chain rather than only in
        // MEV_MAX_LIVE_NOTIONAL_USD_MICROS. An unset ceiling denies the token.
        uint256 amountCap = maxAmountIn[params.tokenIn];
        require(amountCap != 0 && params.amountIn <= amountCap, "AMOUNT_ABOVE_CAP");
        require(isRouterActive(params.routerBuy) && isRouterActive(params.routerSell), "ROUTER_NOT_ALLOWED");
        require(params.routerBuy != params.routerSell, "IDENTICAL_ROUTERS");
        require(params.buyPath.length == 2 && params.sellPath.length == 2, "INVALID_PATH");
        require(params.buyPath[0] == params.tokenIn, "BUY_INPUT_MISMATCH");
        require(params.sellPath[params.sellPath.length - 1] == params.tokenIn, "SELL_OUTPUT_MISMATCH");
        require(params.buyPath[params.buyPath.length - 1] == params.sellPath[0], "PATH_DISCONNECTED");
        require(params.buyPath[1] != params.tokenIn, "IDENTICAL_PATH_TOKENS");

        IERC20Minimal inputToken = IERC20Minimal(params.tokenIn);
        IERC20Minimal intermediateToken = IERC20Minimal(params.buyPath[params.buyPath.length - 1]);
        uint256 inputBefore = inputToken.balanceOf(address(this));
        require(inputBefore >= params.amountIn, "INSUFFICIENT_EXECUTOR_BALANCE");
        uint256 intermediateBefore = intermediateToken.balanceOf(address(this));

        inputToken.forceApprove(params.routerBuy, params.amountIn);
        IV2RouterMinimal(params.routerBuy).swapExactTokensForTokens(
            params.amountIn, 1, params.buyPath, address(this), params.deadline
        );
        inputToken.forceApprove(params.routerBuy, 0);

        uint256 intermediateReceived = intermediateToken.balanceOf(address(this)) - intermediateBefore;
        require(intermediateReceived > 0, "NO_INTERMEDIATE_OUTPUT");
        intermediateToken.forceApprove(params.routerSell, intermediateReceived);
        IV2RouterMinimal(params.routerSell).swapExactTokensForTokens(
            intermediateReceived,
            params.amountIn + params.minProfit,
            params.sellPath,
            address(this),
            params.deadline
        );
        intermediateToken.forceApprove(params.routerSell, 0);

        uint256 inputAfter = inputToken.balanceOf(address(this));
        require(inputAfter >= inputBefore + params.minProfit, "MIN_PROFIT_NOT_MET");
        profit = inputAfter - inputBefore;
        inputToken.safeTransfer(params.recipient, profit);
        emit ArbitrageExecuted(params.executionId, params.tokenIn, params.recipient, params.amountIn, profit);
    }

    /// @notice Recovery is explicit and owner-only; it is not used by execution.
    /// @dev Constrained to allowlisted recipients. Without this, recovery was the
    ///      shortest path from control-plane compromise to a full drain of the
    ///      contract's working capital: the owner check alone is satisfied by
    ///      anything able to use the signing key.
    function recoverToken(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        require(to != address(0), "ZERO_RECIPIENT");
        require(isRecipientActive(to), "RECIPIENT_NOT_ALLOWED");
        IERC20Minimal(token).safeTransfer(to, amount);
        // Every other privileged action here emits. A full-balance value exit
        // that emitted nothing was the one privileged path off-chain monitoring
        // could not see.
        emit TokenRecovered(token, to, amount);
    }
}
