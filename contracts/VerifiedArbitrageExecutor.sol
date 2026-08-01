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
    function safeTransfer(IERC20Minimal token, address to, uint256 amount) internal {
        (bool success, bytes memory result) = address(token).call(
            abi.encodeCall(IERC20Minimal.transfer, (to, amount))
        );
        require(success && (result.length == 0 || abi.decode(result, (bool))), "TRANSFER_FAILED");
    }

    function forceApprove(IERC20Minimal token, address spender, uint256 amount) internal {
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

    address public owner;
    address public pendingOwner;
    uint256 private locked = 1;
    mapping(address => bool) public allowedRouters;

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

    event RouterPermissionUpdated(address indexed router, bool allowed);
    event OwnershipTransferStarted(address indexed owner, address indexed pendingOwner);
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

    function setRouterAllowed(address router, bool allowed) external onlyOwner {
        require(router != address(0), "ZERO_ROUTER");
        allowedRouters[router] = allowed;
        emit RouterPermissionUpdated(router, allowed);
    }

    function startOwnershipTransfer(address newOwner) external onlyOwner {
        require(newOwner != address(0), "ZERO_OWNER");
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "NOT_PENDING_OWNER");
        address previousOwner = owner;
        owner = msg.sender;
        pendingOwner = address(0);
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
        require(params.amountIn > 0 && params.minProfit > 0, "ZERO_AMOUNT");
        require(params.recipient != address(0), "ZERO_RECIPIENT");
        require(allowedRouters[params.routerBuy] && allowedRouters[params.routerSell], "ROUTER_NOT_ALLOWED");
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
    function recoverToken(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        require(to != address(0), "ZERO_RECIPIENT");
        IERC20Minimal(token).safeTransfer(to, amount);
    }
}
