// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";

/**
 * @title SHIB风格Meme代币合约
 * @dev 实现了代币税机制、流动性池集成和交易限制功能，基于ERC20标准，集成SHIB代币的经济模型特性
 */
contract SHIBToken is ERC20, AccessControl, ReentrancyGuard, Pausable {

    using EnumerableSet for EnumerableSet.AddressSet;

    // ==================== 核心常量与角色 ====================
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");   // 管理员
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE"); // 紧急守护者
    uint256 public constant MAX_SUPPLY = 1e15 * 10**18; // 1千万亿枚
    address public immutable DEAD_WALLET = 0x000000000000000000000000000000000000dEaD;  // 销毁地址（无主地址，任何人都能在区块浏览器查询该地址的资产，确认代币确实被销毁，增强社区信任。）
    uint256 public constant BPS_DENOMINATOR = 10000; // 万分数基数

    // ==================== -Uniswap 配置 ====================
    IUniswapV2Router02 public immutable uniswapRouter;  // 连接代币与交易市场的关键工具(主要功能：代币兑换、流动性管理、价格查询等)
    address public immutable uniswapPair; // 交易对地址
    bool public isSwapEnabled = false; // 自动添加流动性开关（部署后启用）
    uint256 public swapThreshold = 100_000_000 * 10**18; // 触发自动添加流动性的阈值

    // ==================== 税收与分配 ====================
    uint256 public buyTaxBps = 500; // 买入税：5%
    uint256 public sellTaxBps = 1000; // 卖出税：10%
    uint256 public constant MAX_TAX_BPS = 2000; // 最高税率限制20%

    uint256 public liquidityBps = 4000; // 40% 用于流动性（合约地址当做流动性池）
    uint256 public treasuryBps = 3000; // 30% 国库
    uint256 public burnBps = 3000; // 30% 销毁
    address public treasury;    // 国库地址（用户运营/激励）
    
    // ==================== 防操控机制 ====================
    uint256 public maxTxPercent = 100; // 单笔最大交易占比（1%）
    uint256 public minDelayBetweenTx = 30 seconds; // 同一地址交易间隔（防机器人）
    mapping(address => uint256) public lastTxTime; // 记录每个地址上次交易时间

    // ==================== 权限与安全 ====================
    EnumerableSet.AddressSet private _whitelist; // 白名单（支持批量管理）
    bool public isLpLocked = false; // LP锁定状态
    uint256 public lpLockTimestamp; // LP锁定截止时间
    mapping(address => bool) public isTaxExempt; // 免税地址（如国库、合约自身）

    // ==================== 时间锁（管理员操作延迟） ====================
    uint256 public minLockLp = 365 days; // 最小LP锁定时间 (为了方便测试，这里支持构造函数传入修改)
    uint256 public adminDelay = 48 hours; // 管理员操作延迟执行时间(为了方便测试，这里支持构造函数传入修改)
    mapping(bytes32 => TimelockOperation) public timelockOperations; // 时间锁操作

    struct TimelockOperation {
        bool exists;
        address proposer;
        uint256 executionTime;
        bool executed;
    }

    // ==================== 事件 ====================
    event SwapAndLiquify(uint256 tokensSwapped, uint256 ethReceived, uint256 tokensAddedToLp);  // 兑换并存入流动池
    event LpLocked(uint256 lockDuration);   // 流动池锁定事件
    event TimelockOperationProposed(bytes32 indexed opId, uint256 executionTime);   // 管理员操作提出事件
    event TimelockOperationExecuted(bytes32 indexed opId);  // 操作执行事件
    event TaxUpdated(uint256 buyTax, uint256 sellTax);  // 税率更新
    event MinTxDelayUpdated(uint256 newDelay);  // 交易间隔时间更新

    // ==================== 构造函数 ====================
    constructor(
        string memory name,
        string memory symbol,
        address _treasury,
        address _router, // Uniswap V2 Router地址（如ETH主网：0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D）
        uint256 _minLockLp,
        uint256 _adminDelay
    ) ERC20(name, symbol) {
        require(_treasury != address(0), "Treasury zero address");
        require(_router != address(0), "Router zero address");
        
        minLockLp = _minLockLp;
        adminDelay = _adminDelay;

        // 初始化Uniswap，创建交易代币对
        uniswapRouter = IUniswapV2Router02(_router);
        uniswapPair = IUniswapV2Factory(uniswapRouter.factory()).createPair(address(this), uniswapRouter.WETH());

        // 铸造初始代币给创建者
        _mint(msg.sender, MAX_SUPPLY);

        // 初始化角色
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(GUARDIAN_ROLE, msg.sender);

        // 初始化地址
        treasury = _treasury;
        isTaxExempt[treasury] = true;
        isTaxExempt[address(this)] = true;
        _whitelist.add(msg.sender);
        _whitelist.add(uniswapPair);
        _whitelist.add(DEAD_WALLET);
    }

    // ==================== 核心功能：带税转账 + 自动流动性 ====================
    function transfer(address to, uint256 amount) public override whenNotPaused returns (bool) {
        _transferWithTax(_msgSender(), to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public override whenNotPaused returns (bool) {
        address spender = _msgSender();
        // 检查调用者是否有from代币转账权限
        _spendAllowance(from, spender, amount);
        _transferWithTax(from, to, amount);
        return true;
    }

    function _transferWithTax(address from, address to, uint256 amount) internal nonReentrant {
        require(from != address(0) && to != address(0), "Zero address");
        require(amount > 0, "Zero amount");

        // 1. 防机器人：检查交易间隔（非白名单地址）
        if (!_whitelist.contains(from) && !_whitelist.contains(to)) {
            require(block.timestamp > lastTxTime[from] + minDelayBetweenTx, "Too frequent transactions");
            lastTxTime[from] = block.timestamp;
        }

        // 2. 检查单笔交易限额
        if (!_whitelist.contains(from) && !_whitelist.contains(to)) {
            uint256 maxTxAmount = (MAX_SUPPLY * maxTxPercent) / BPS_DENOMINATOR;
            require(amount <= maxTxAmount, "Exceeds max tx amount");
        }

        // 3. 计算税收
        uint256 taxAmount = 0;
        if (!isTaxExempt[from] && !isTaxExempt[to]) {
            // 判断是买入还是卖出（向流动性池转账视为卖出，从流动性池转入视为买入）
            bool isSell = to == uniswapPair;
            bool isBuy = from == uniswapPair;
            uint256 taxBps = isSell ? sellTaxBps : (isBuy ? buyTaxBps : buyTaxBps);
            taxAmount = (amount * taxBps) / BPS_DENOMINATOR;
        }

        // 4. 实际转账金额
        uint256 transferAmount = amount - taxAmount;

        // 5. 分配税费（先累计，达到阈值后自动添加流动性）
        if (taxAmount > 0) {
            _distributeTax(from, taxAmount);
        }

        // 6. 执行转账
        super._transfer(from, to, transferAmount);
    }

    // 分配税费（部分累计，达到阈值自动添加流动性）
    function _distributeTax(address from, uint256 taxAmount) internal {
        uint256 liquidityAmount = (taxAmount * liquidityBps) / BPS_DENOMINATOR;     // 入流动池金额
        uint256 burnAmount = (taxAmount * burnBps) / BPS_DENOMINATOR;               // 销毁金额
        uint256 treasuryAmount = taxAmount - liquidityAmount - burnAmount;          // 入国库金额

        // 销毁
        if (burnAmount > 0) {
            super._transfer(from, DEAD_WALLET, burnAmount);
        }

        // 国库
        if (treasuryAmount > 0) {
            super._transfer(from, treasury, treasuryAmount);
        }

        // 流动性（累计到合约，达到阈值自动添加）
        if (liquidityAmount > 0) {
            // 合约地址当做流动性池
            super._transfer(from, address(this), liquidityAmount);
            uint256 contractBalance = balanceOf(address(this));
            if (isSwapEnabled && contractBalance >= swapThreshold) {
                _swapAndLiquify(contractBalance);
            }
        }
    }

    // 自动兑换并添加流动性（将代币兑换为ETH，再配对添加流动性）
    function _swapAndLiquify(uint256 amount) internal {
        uint256 half = amount / 2;
        uint256 otherHalf = amount - half;

        // 1. 兑换一半代币为ETH
        uint256 ethReceived = _swapTokensForEth(half);

        // 2. 添加流动性（剩余代币 + 兑换的ETH）
        _addLiquidity(otherHalf, ethReceived);        

        emit SwapAndLiquify(half, ethReceived, otherHalf);
    }

    /**
     * @dev 交换代币为ETH
     */
    function _swapTokensForEth(uint256 tokenAmount) private returns(uint256 ethReceived) {
        address[] memory path = new address[](2);
        path[0] = address(this);
        path[1] = uniswapRouter.WETH();

        // 交换前记录eth余额
        uint256 initialBalance = address(this).balance;

        // 兑换代币为ETH
        _approve(address(this), address(uniswapRouter), tokenAmount);
        uniswapRouter.swapExactTokensForETHSupportingFeeOnTransferTokens(
            tokenAmount,
            0,
            path,
            address(this),
            block.timestamp
        );
        // 交换后eth余额 - 交换前eth余额 = 兑换的eth
        ethReceived = address(this).balance - initialBalance;
    }

    /**
     * @dev 添加流动性
     */
    function _addLiquidity(uint256 tokenAmount, uint256 ethAmount) private {
        _approve(address(this), address(uniswapRouter), tokenAmount);

        uniswapRouter.addLiquidityETH{value: ethAmount}(
            address(this),
            tokenAmount,
            0,
            0,
            DEAD_WALLET, // 流动性代币发送到销毁地址（永久锁定）
            block.timestamp + 300
        );
    }

    // ==================== 管理员功能（带时间锁） ====================
    // 提案修改税率（需延迟执行）
    function proposeSetTaxBps(uint256 _buyTax, uint256 _sellTax) external onlyRole(ADMIN_ROLE) returns (bytes32 opId) {
        require(_buyTax <= MAX_TAX_BPS && _sellTax <= MAX_TAX_BPS, "Tax exceeds max");
        opId = keccak256(abi.encode("setTaxBps", _buyTax, _sellTax, block.timestamp));
        require(!timelockOperations[opId].exists, "Operation exists");

        timelockOperations[opId] = TimelockOperation({
            exists: true,
            proposer: msg.sender,
            executionTime: block.timestamp + adminDelay,
            executed: false
        });
        emit TimelockOperationProposed(opId, block.timestamp + adminDelay);
    }

    // 执行时间锁操作（修改税率）
    function executeSetTaxBps(uint256 _buyTax, uint256 _sellTax, uint256 proposalTime) external {
        bytes32 opId = keccak256(abi.encode("setTaxBps", _buyTax, _sellTax, proposalTime));
        TimelockOperation storage op = timelockOperations[opId];
        require(op.exists && !op.executed, "Invalid operation");
        require(block.timestamp >= op.executionTime, "Not ready");

        buyTaxBps = _buyTax;
        sellTaxBps = _sellTax;
        op.executed = true;
        emit TaxUpdated(_buyTax, _sellTax);
        emit TimelockOperationExecuted(opId);
    }

    // 锁定LP（防止开发者抽走初始流动性）
    function lockLP(uint256 lockDuration) external onlyRole(ADMIN_ROLE) {
        require(!isLpLocked, "Already locked");
        require(lockDuration >= minLockLp, "Min lock 1 year"); // 至少锁定1年

        isLpLocked = true;
        lpLockTimestamp = block.timestamp + lockDuration;
        emit LpLocked(lockDuration);
    }

    // ==================== 紧急功能（守护者角色） ====================
    // 暂停交易（漏洞修复时使用）
    function pause() external onlyRole(GUARDIAN_ROLE) {
        _pause();
    }

    // 恢复交易
    function unpause() external onlyRole(GUARDIAN_ROLE) {
        _unpause();
    }

    // 调整交易间隔（防机器人参数）
    function setMinTxDelay(uint256 newDelay) external onlyRole(GUARDIAN_ROLE) {
        require(newDelay >= 10 seconds && newDelay <= 5 minutes, "Invalid delay");
        minDelayBetweenTx = newDelay;
        emit MinTxDelayUpdated(newDelay);
    }

    // ==================== 白名单管理 ====================
    function addWhitelist(address account) external onlyRole(ADMIN_ROLE) {
        _whitelist.add(account);
    }

    function removeWhitelist(address account) external onlyRole(ADMIN_ROLE) {
        _whitelist.remove(account);
    }

    function isWhitelisted(address account) external view returns (bool) {
        return _whitelist.contains(account);
    }

    // ==================== 辅助函数 ====================
    // 接收ETH（添加流动性时需要）
    receive() external payable {}

    // 查看实际到账金额
    function getNetTransferAmount(address from, address to, uint256 amount) public view returns (uint256) {
        if (isTaxExempt[from] || isTaxExempt[to]) return amount;
        bool isSell = to == uniswapPair;
        bool isBuy = from == uniswapPair;
        uint256 taxBps = isSell ? sellTaxBps : (isBuy ? buyTaxBps : buyTaxBps);
        return amount - (amount * taxBps) / BPS_DENOMINATOR;
    }

    function getTax() external view returns (uint256 _buyTaxBps, uint256 _sellTaxBps) {
        _buyTaxBps = buyTaxBps;
        _sellTaxBps = sellTaxBps;
    }

    function getTaxDistribute() external view returns (uint256 _liquidityBps, uint256 _treasuryBps, uint256 _burnBps) {
        _liquidityBps = liquidityBps;
        _treasuryBps = treasuryBps;
        _burnBps = burnBps;  
    }

    function getLpLockDuration() external view returns (uint256) {
        return lpLockTimestamp - block.timestamp;
    }

    function getMinDelayBetweenTx() external view returns (uint256) {
        return minDelayBetweenTx;
    }
}