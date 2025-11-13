// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract NewMetaNodeStake is
    Initializable,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    // ========== 角色与常量定义 ==========
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    uint256 public constant ETH_POOL_PID = 0; // 0号池固定为ETH

    // ========== 功能暂停状态 ==========
    enum FunctionType {
        STAKE,
        UNSTAKE,
        CLAIM_REWARD
    }
    mapping(FunctionType => bool) public isFunctionPaused;

    // ========== 核心数据结构 ==========
    /// @dev 质押池配置信息
    struct PoolInfo {
        address stToken; // 质押代币地址（ETH用address(0)表示）
        uint256 poolWeight; // 池权重（影响奖励分配比例）
        uint256 minDepositAmount; // 最小质押金额（ETH单位为wei，ERC20为最小单位）
        uint256 unstakeLockedBlocks; // 解质押锁定期（区块数）
        uint256 totalStaked; // 池内总质押量
        bool isEth; // 是否为ETH池
        bool exists; // 池是否存在
    }

    /// @dev 用户质押信息
    struct UserStakeInfo {
        uint256 stakedAmount; // 用户质押总量
        uint256 lastRewardBlock; // 上次计算奖励的区块号
        uint256 pendingReward; // 待领取奖励
        uint256 totalClaimed; // 用户累计领取奖励
        UnstakeRequest[] unstakeRequests; // 解质押请求列表（移至此）
    }

    /// @dev 解质押请求
    struct UnstakeRequest {
        uint256 amount; // 解质押数量
        uint256 unlockBlock; // 解锁区块号
        bool claimed; // 是否已提取
    }

    // ========== 状态变量 ==========
    IERC20 public rewardToken; // 奖励代币（MetaNode）
    uint256 public baseRewardPerBlock; // 每区块总奖励（按此值按权重分配到各池）
    uint256 public totalPoolWeight; // 所有池的权重总和（用于计算比例）
    uint256 public poolCount; // 质押池总数（含ETH池）
    uint256 public totalRewardDistributed; // 全局累计分配奖励总量

    mapping(uint256 => PoolInfo) public pools; // 池ID -> 池信息
    mapping(address => mapping(uint256 => UserStakeInfo)) public userStakeInfos; // 用户 -> 池ID -> 质押信息

    // ========== 事件 ==========
    event Staked(
        address indexed user,
        uint256 indexed pid,
        uint256 amount,
        uint256 blockNumber
    );
    event EthStaked(address indexed user, uint256 amount, uint256 blockNumber); // ETH质押单独事件
    event UnstakeRequested(
        address indexed user,
        uint256 indexed pid,
        uint256 amount,
        uint256 unlockBlock
    );
    event UnstakedWithdrawn(
        address indexed user,
        uint256 indexed pid,
        uint256 amount,
        uint256 blockNumber
    );
    event RewardClaimed(
        address indexed user,
        uint256 indexed pid,
        uint256 amount,
        uint256 totalUserClaimed
    );
    event PoolAdded(
        uint256 indexed pid,
        address stToken,
        bool isEth,
        uint256 poolWeight
    );
    event PoolUpdated(
        uint256 indexed pid,
        uint256 poolWeight,
        uint256 minDeposit,
        uint256 lockedBlocks
    );
    event BaseRewardUpdated(uint256 oldRate, uint256 newRate);
    event FunctionPaused(FunctionType functionType, uint256 blockNumber);
    event FunctionUnpaused(FunctionType functionType, uint256 blockNumber);

    // ========== 初始化与升级 ==========
    function initialize(
        address _rewardToken,
        uint256 _baseRewardPerBlock
    ) public initializer {
        __AccessControl_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        require(_rewardToken != address(0), "Invalid reward token");
        require(_baseRewardPerBlock > 0, "Base reward must be positive");

        rewardToken = IERC20(_rewardToken);
        baseRewardPerBlock = _baseRewardPerBlock;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
        _grantRole(UPGRADER_ROLE, msg.sender);
    }

    /// @dev UUPS升级函数，仅升级角色可调用
    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyRole(UPGRADER_ROLE) {}

    // ========== 质押池管理（管理员） ==========
    /**
     * @dev 添加或更新质押池（0号池必须是ETH且优先添加）
     * 0号池参数：_stTokenAddress=address(0), _isEth=true
     */
    function addOrUpdatePool(
        uint256 _pid,
        address _stTokenAddress,
        bool _isEth,
        uint256 _poolWeight,
        uint256 _minDepositAmount,
        uint256 _unstakeLockedBlocks
    ) external onlyRole(ADMIN_ROLE) {
        // 验证0号池必须是ETH
        if (_pid == ETH_POOL_PID) {
            require(_isEth && _stTokenAddress == address(0), "0 poll must ETH");
        } else {
            // 非0号池必须在0号池添加后才能创建
            require(pools[ETH_POOL_PID].exists, "first add 0 poll");
            require(
                !_isEth && _stTokenAddress != address(0),
                "not 0 poll need ERC20"
            );
        }

        require(_poolWeight > 0, "pool weight must be positive");
        require(_minDepositAmount > 0, "minDepositAmount must be positive");
        require(_unstakeLockedBlocks > 0, "unstakeLockedBlocks must be positive");

        PoolInfo storage pool = pools[_pid];
        bool isNewPool = !pool.exists;

        // 更新总权重（移除旧权重，添加新权重）
        if (isNewPool) {
            totalPoolWeight += _poolWeight;
            poolCount++;
            pool.exists = true;
            pool.stToken = _stTokenAddress;
            pool.isEth = _isEth;
        } else {
            totalPoolWeight = totalPoolWeight - pool.poolWeight + _poolWeight;
        }

        // 更新池配置
        pool.poolWeight = _poolWeight;
        pool.minDepositAmount = _minDepositAmount;
        pool.unstakeLockedBlocks = _unstakeLockedBlocks;

        if (isNewPool) {
            emit PoolAdded(_pid, _stTokenAddress, _isEth, _poolWeight);
        } else {
            emit PoolUpdated(
                _pid,
                _poolWeight,
                _minDepositAmount,
                _unstakeLockedBlocks
            );
        }
    }

    /**
     * @dev 单独更新池权重（不影响其他配置）
     */
    function updatePoolWeight(
        uint256 _pid,
        uint256 _newWeight
    ) external onlyRole(ADMIN_ROLE) {
        require(pools[_pid].exists, "pool does not exist");
        require(_newWeight > 0, "new weight must be positive");

        PoolInfo storage pool = pools[_pid];
        totalPoolWeight = totalPoolWeight - pool.poolWeight + _newWeight;
        pool.poolWeight = _newWeight;

        emit PoolUpdated(
            _pid,
            _newWeight,
            pool.minDepositAmount,
            pool.unstakeLockedBlocks
        );
    }

    /**
     * @dev 更新每区块基础奖励总量
     */
    function setBaseRewardPerBlock(
        uint256 _newBaseReward
    ) external onlyRole(ADMIN_ROLE) {
        require(_newBaseReward > 0, "new base reward must be positive");
        emit BaseRewardUpdated(baseRewardPerBlock, _newBaseReward);
        baseRewardPerBlock = _newBaseReward;
    }

    // ========== 质押功能 ==========
    /**
     * @dev ERC20代币质押
     */
    function stake(uint256 _pid, uint256 _amount) external nonReentrant {
        require(!isFunctionPaused[FunctionType.STAKE], "stake function is paused");
        PoolInfo storage pool = pools[_pid];
        require(pool.exists && !pool.isEth, "pool does not exist or is ETH");
        require(_amount >= pool.minDepositAmount, "low minDepositAmount");

        // 计算奖励
        _calculateReward(_pid, msg.sender);

        // 转移ERC20代币
        IERC20(pool.stToken).safeTransferFrom(
            msg.sender,
            address(this),
            _amount
        );

        // 更新用户与池数据
        UserStakeInfo storage userStake = userStakeInfos[msg.sender][_pid];
        userStake.stakedAmount += _amount;
        userStake.lastRewardBlock = block.number;
        pool.totalStaked += _amount;

        emit Staked(msg.sender, _pid, _amount, block.number);
    }

    /**
     * @dev ETH质押（仅0号池）
     */
    function stakeEth() external payable nonReentrant {
        uint256 _pid = ETH_POOL_PID;
        require(!isFunctionPaused[FunctionType.STAKE], "stake function is paused");
        PoolInfo storage pool = pools[_pid];
        require(pool.exists && pool.isEth, "eth pool does not exist");
        require(msg.value >= pool.minDepositAmount, "low minDepositAmount");

        // 计算奖励
        _calculateReward(_pid, msg.sender);

        // 更新用户与池数据（ETH直接通过msg.value接收）
        UserStakeInfo storage userStake = userStakeInfos[msg.sender][_pid];
        userStake.stakedAmount += msg.value;
        userStake.lastRewardBlock = block.number;
        pool.totalStaked += msg.value;

        emit EthStaked(msg.sender, msg.value, block.number);
    }

    // ========== 解质押功能 ==========
    /**
     * @dev 发起解质押请求（ERC20/ETH通用）
     */
    function unstake(uint256 _pid, uint256 _amount) external nonReentrant {
        require(!isFunctionPaused[FunctionType.UNSTAKE], "unstake function is paused");
        PoolInfo storage pool = pools[_pid];
        require(pool.exists, "pool does not exist");
        require(_amount > 0, "amount must be positive");

        // 计算奖励
        _calculateReward(_pid, msg.sender);

        // 验证用户质押余额
        UserStakeInfo storage userStake = userStakeInfos[msg.sender][_pid];
        require(userStake.stakedAmount >= _amount, "more than staked");

        // 更新质押数据
        userStake.stakedAmount -= _amount;
        userStake.lastRewardBlock = block.number;
        pool.totalStaked -= _amount;

        // 创建解质押请求
        uint256 unlockBlock = block.number + pool.unstakeLockedBlocks;
        userStake.unstakeRequests.push(
            UnstakeRequest({
                amount: _amount,
                unlockBlock: unlockBlock,
                claimed: false
            })
        );

        emit UnstakeRequested(msg.sender, _pid, _amount, unlockBlock);
    }

    /**
     * @dev 提取已解锁的解质押资产（ERC20/ETH通用）
     */
    function withdrawUnstaked(uint256 _pid) external nonReentrant {
        require(!isFunctionPaused[FunctionType.UNSTAKE], "unstake function is paused");
        PoolInfo storage pool = pools[_pid];
        require(pool.exists, "pool does not exist");

        UserStakeInfo storage userStake = userStakeInfos[msg.sender][_pid];
        UnstakeRequest[] storage requests = userStake.unstakeRequests;
        uint256 totalWithdrawable = 0;

        // 筛选已解锁且未提取的请求
        for (uint256 i = 0; i < requests.length; i++) {
            UnstakeRequest storage req = requests[i];
            if (!req.claimed && block.number >= req.unlockBlock) {
                totalWithdrawable += req.amount;
                req.claimed = true;
            }
        }

        require(totalWithdrawable > 0, "zero withdrawable");

        // 转移资产（ETH用call，ERC20用transfer）
        if (pool.isEth) {
            (bool success, ) = msg.sender.call{value: totalWithdrawable}("");
            require(success, "eth transfer failed");
        } else {
            IERC20(pool.stToken).safeTransfer(msg.sender, totalWithdrawable);
        }

        emit UnstakedWithdrawn(
            msg.sender,
            _pid,
            totalWithdrawable,
            block.number
        );
    }

    // ========== 奖励领取功能 ==========
    function claimReward(uint256 _pid) external nonReentrant {
        require(!isFunctionPaused[FunctionType.CLAIM_REWARD], "claimReward function is paused");
        PoolInfo storage pool = pools[_pid];
        require(pool.exists, "pool not exists");

        // 计算奖励
        _calculateReward(_pid, msg.sender);

        UserStakeInfo storage userStake = userStakeInfos[msg.sender][_pid];
        uint256 rewardAmount = userStake.pendingReward;
        require(rewardAmount > 0, "zero claimReward");

        // 更新奖励数据
        userStake.pendingReward = 0;
        userStake.totalClaimed += rewardAmount;
        totalRewardDistributed += rewardAmount;

        // 转移奖励代币
        rewardToken.safeTransfer(msg.sender, rewardAmount);

        emit RewardClaimed(
            msg.sender,
            _pid,
            rewardAmount,
            userStake.totalClaimed
        );
    }

    // ========== 奖励计算核心逻辑 ==========
    /**
     * @dev 计算用户在指定池的未领取奖励
     * 逻辑：单池奖励 = 每区块总奖励 × (单池权重 / 总权重) × 质押量占比 × 区块数
     * 质押量占比 = 用户质押量 / 池总质押量（避免质押量为0时奖励异常）
     */
    function _calculateReward(uint256 _pid, address _user) internal {
        PoolInfo storage pool = pools[_pid];
        UserStakeInfo storage userStake = userStakeInfos[_user][_pid];

        // 无质押量或总权重为0时不计算奖励
        if (
            userStake.stakedAmount == 0 ||
            totalPoolWeight == 0 ||
            pool.totalStaked == 0
        ) {
            userStake.lastRewardBlock = block.number;
            return;
        }

        // 计算奖励周期内的区块数（当前区块 - 个人上次计算区块）
        uint256 blockDiff = block.number - userStake.lastRewardBlock;
        if (blockDiff <= 0) return;

        // 计算单池每区块奖励：总奖励 × (单池权重 / 总权重)
        uint256 poolRewardPerBlock = (baseRewardPerBlock * pool.poolWeight) /
            totalPoolWeight;
        // 计算用户在该池的奖励占比：用户质押量 / 池总质押量
        uint256 userShare = (userStake.stakedAmount * 1e18) / pool.totalStaked; // 放大1e18避免精度丢失
        // 计算用户奖励：单池每区块奖励 × 区块数 × (用户占比 / 1e18)
        uint256 reward = (poolRewardPerBlock * blockDiff * userShare) / 1e18;

        // 累计待领取奖励
        userStake.pendingReward += reward;
        // 更新个人基准区块
        userStake.lastRewardBlock = block.number;
    }

    // ========== 功能暂停/恢复（管理员） ==========
    function pauseFunction(
        FunctionType _functionType
    ) external onlyRole(ADMIN_ROLE) {
        require(!isFunctionPaused[_functionType], "function is already paused");
        isFunctionPaused[_functionType] = true;
        emit FunctionPaused(_functionType, block.number);
    }

    function unpauseFunction(
        FunctionType _functionType
    ) external onlyRole(ADMIN_ROLE) {
        require(isFunctionPaused[_functionType], "function is not paused");
        isFunctionPaused[_functionType] = false;
        emit FunctionUnpaused(_functionType, block.number);
    }

    // ========== 视图函数（数据查询） ==========
    /**
     * @dev 查询用户在指定池的待领取奖励
     */
    function getUserPendingReward(
        uint256 _pid,
        address _user
    ) external view returns (uint256) {
        PoolInfo storage pool = pools[_pid];
        require(pool.exists, "pool not exists");

        UserStakeInfo storage userStake = userStakeInfos[_user][_pid];
        if (
            userStake.stakedAmount == 0 ||
            totalPoolWeight == 0 ||
            pool.totalStaked == 0
        ) {
            return userStake.pendingReward;
        }

        uint256 blockDiff = block.number - userStake.lastRewardBlock;
        if (blockDiff <= 0) return userStake.pendingReward;

        uint256 poolRewardPerBlock = (baseRewardPerBlock * pool.poolWeight) /
            totalPoolWeight;
        uint256 userShare = (userStake.stakedAmount * 1e18) / pool.totalStaked;
        uint256 reward = (poolRewardPerBlock * blockDiff * userShare) / 1e18;

        return userStake.pendingReward + reward;
    }

    /**
     * @dev 查询用户在指定池的可提取解质押金额
     */
    function getUserWithdrawableAmount(
        uint256 _pid,
        address _user
    ) external view returns (uint256) {
        PoolInfo storage pool = pools[_pid];
        require(pool.exists, "pool not exists");

        UserStakeInfo storage userStake = userStakeInfos[_user][_pid];
        UnstakeRequest[] storage requests = userStake.unstakeRequests;
        uint256 total = 0;
        for (uint256 i = 0; i < requests.length; i++) {
            UnstakeRequest storage req = requests[i];
            if (!req.claimed && block.number >= req.unlockBlock) {
                total += req.amount;
            }
        }
        return total;
    }

    /**
     * @dev 查询指定池的每区块奖励（供前端展示）
     */
    function getPoolRewardPerBlock(
        uint256 _pid
    ) external view returns (uint256) {
        PoolInfo storage pool = pools[_pid];
        require(pool.exists, "pool not exists");
        if (totalPoolWeight == 0) return 0;
        return (baseRewardPerBlock * pool.poolWeight) / totalPoolWeight;
    }

    // ========== 接收ETH（用于ETH质押） ==========
    receive() external payable {
        // 禁止直接向合约转账ETH，必须通过stakeEth函数
        revert("please use stakeEth function to stake ETH");
    }
}
