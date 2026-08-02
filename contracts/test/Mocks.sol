// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal ERC20 sufficient to drive the executor and a V2-style router.
/// @dev Deliberately returns `bool` from transfer/approve so the standard path is
///      exercised. `NonCompliantERC20` below covers the USDT-style variant that
///      returns nothing, which is why the executor uses SafeToken at all.
contract MockERC20 {
    string public name;
    uint8 public decimals;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory tokenName, uint8 tokenDecimals) {
        name = tokenName;
        decimals = tokenDecimals;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external virtual returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external virtual returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external virtual returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "MOCK_ALLOWANCE");
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "MOCK_BALANCE");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}

/// @notice USDT-style token whose `approve`/`transfer` return no data at all.
/// @dev SafeToken must accept an empty return buffer as success. A naive
///      `IERC20.transfer()` call against this reverts on ABI decode.
contract NonCompliantERC20 is MockERC20 {
    constructor(string memory tokenName, uint8 tokenDecimals) MockERC20(tokenName, tokenDecimals) {}

    function approve(address spender, uint256 amount) external override returns (bool) {
        allowance[msg.sender][spender] = amount;
        assembly {
            return(0, 0)
        }
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        _transfer(msg.sender, to, amount);
        assembly {
            return(0, 0)
        }
    }
}

/// @notice Token that requires approval to be reset to zero before being changed.
/// @dev The other half of why `forceApprove` exists.
contract ResetRequiredERC20 is MockERC20 {
    constructor(string memory tokenName, uint8 tokenDecimals) MockERC20(tokenName, tokenDecimals) {}

    function approve(address spender, uint256 amount) external override returns (bool) {
        require(amount == 0 || allowance[msg.sender][spender] == 0, "APPROVE_FROM_NON_ZERO");
        allowance[msg.sender][spender] = amount;
        return true;
    }
}

/// @notice Constant-rate V2-style router. Must be pre-funded with the output token.
contract MockRouter {
    /// Output = amountIn * rateNumerator / rateDenominator.
    uint256 public rateNumerator;
    uint256 public rateDenominator;

    constructor(uint256 numerator, uint256 denominator) {
        rateNumerator = numerator;
        rateDenominator = denominator;
    }

    function setRate(uint256 numerator, uint256 denominator) external {
        rateNumerator = numerator;
        rateDenominator = denominator;
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts) {
        require(block.timestamp <= deadline, "ROUTER_EXPIRED");
        require(path.length >= 2, "ROUTER_PATH");
        _safeTransferFrom(path[0], msg.sender, address(this), amountIn);
        uint256 amountOut = (amountIn * rateNumerator) / rateDenominator;
        require(amountOut >= amountOutMin, "INSUFFICIENT_OUTPUT_AMOUNT");
        _safeTransfer(path[path.length - 1], to, amountOut);
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = amountOut;
    }

    // PancakeSwap's router moves tokens through TransferHelper, which tolerates
    // an empty return buffer. Decoding a `bool` here instead would make this
    // mock reject USDT-style tokens that the real router handles fine, and the
    // resulting test failure would look like a bug in the executor.
    function _safeTransferFrom(address token, address from, address to, uint256 amount) private {
        (bool ok, bytes memory ret) = token.call(
            abi.encodeWithSignature("transferFrom(address,address,uint256)", from, to, amount)
        );
        require(ok && (ret.length == 0 || abi.decode(ret, (bool))), "ROUTER_TRANSFER_FROM_FAILED");
    }

    function _safeTransfer(address token, address to, uint256 amount) private {
        (bool ok, bytes memory ret) = token.call(
            abi.encodeWithSignature("transfer(address,uint256)", to, amount)
        );
        require(ok && (ret.length == 0 || abi.decode(ret, (bool))), "ROUTER_TRANSFER_FAILED");
    }
}

/// @notice Router that calls an arbitrary target mid-swap.
/// @dev Aimed straight at the executor it proves a malicious router cannot
///      re-enter. Aimed at a `ReentrantOwner` it routes the re-entry back
///      through the owner, which is the only way to get past `onlyOwner` and
///      actually reach the `nonReentrant` guard.
contract ReentrantRouter {
    address public target;
    bytes public payload;

    function arm(address callTarget, bytes calldata callPayload) external {
        target = callTarget;
        payload = callPayload;
    }

    function swapExactTokensForTokens(
        uint256,
        uint256,
        address[] calldata,
        address,
        uint256
    ) external returns (uint256[] memory amounts) {
        (bool ok, bytes memory ret) = target.call(payload);
        // Bubble the inner revert reason up so the test can assert on it.
        if (!ok) {
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
        amounts = new uint256[](2);
    }
}

/// @notice Contract owner that re-enters the executor when prodded.
/// @dev Exists so the `nonReentrant` guard is reachable at all. With an EOA
///      owner it never fires, because `onlyOwner` rejects every re-entrant
///      caller first.
contract ReentrantOwner {
    address public executor;
    bytes public payload;

    function configure(address executorAddress, bytes calldata callPayload) external {
        executor = executorAddress;
        payload = callPayload;
    }

    /// Outer entry point: the owner starts a legitimate execution.
    function start() external {
        _call();
    }

    /// Called by the router mid-swap, so the re-entrant call arrives from the
    /// owner address and clears `onlyOwner`.
    function reenter() external {
        _call();
    }

    function _call() private {
        (bool ok, bytes memory ret) = executor.call(payload);
        if (!ok) {
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
    }
}
