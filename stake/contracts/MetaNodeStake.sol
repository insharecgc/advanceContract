// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";

/**
 * @title MetaNodeStake
 * @author 未知（请补充作者信息）
 * @notice 多质押池Staking合约，支持ETH和ERC20代币质押，基于区块奖励分发MetaNode代币
 * @dev 采用可升级架构，实现角色控制、质押解锁等功能。奖励计算逻辑：
 *      用户待分配奖励 = （用户质押量 × 池累积奖励系数） - 已发放奖励 + 待领取奖励
 *      Solidity 0.8+自带溢出检查，移除冗余的安全数学函数调用
 */
contract MetaNodeStake is
    Initializable,
    UUPSUpgradeable,
    PausableUpgradeable,
    AccessControlUpgradeable
{
    using SafeERC20 for IERC20;
    using Address for address;

    // 常量定义
    bytes32 public constant ADMIN_ROLE = keccak256("admin_role"); // 管理员角色（核心配置权限）
    bytes32 public constant UPGRADE_ROLE = keccak256("upgrade_role"); // 升级角色（仅合约升级权限）
    uint256 public constant ETH_PID = 0; // ETH质押池固定ID

    // 数据结构
    struct Pool {
        address stTokenAddress; // 质押代币地址（ETH池为address(0)）
        uint256 poolWeight; // 池权重（决定奖励分配比例，权重越高分得奖励越多）
        uint256 lastRewardBlock; // 上次计算奖励的区块号（用于计算区间奖励）
        uint256 accMetaNodePerST; // 每单位质押代币的累积MetaNode奖励系数（放大1e18倍避免小数误差）
        uint256 stTokenAmount; // 池总质押量（所有用户在此池的质押总和）
        uint256 minDepositAmount; // 最小质押金额（防止小额质押浪费gas）
        uint256 unstakeLockedBlocks; // 解锁锁定区块数（申请解锁后需等待的区块数）
    }

    struct UnstakeRequest {
        uint256 amount; // 解锁申请金额
        uint256 unlockBlocks; // 可提取的区块号（当前区块 >= 此值时可提取）
    }

    struct User {
        uint256 stAmount; // 用户质押量（当前在池中的有效质押）
        uint256 finishedMetaNode; // 已发放奖励总量（记录已领取的奖励，用于计算待领取）
        uint256 pendingMetaNode; // 待领取奖励（未及时领取的奖励暂存于此）
        UnstakeRequest[] requests; // 解锁申请列表（按申请时间存储，记录所有未提取的解锁申请）
    }

    // 状态变量
    uint256 public startBlock; // 奖励开始区块号（小于此区块的质押不参与奖励计算）
    uint256 public endBlock; // 奖励结束区块号（大于此区块的质押不参与奖励计算）
    uint256 public MetaNodePerBlock; // 每区块MetaNode奖励总量（按池权重分配到各池）

    bool public withdrawPaused; // 提取功能暂停开关（紧急情况下禁止提取）
    bool public claimPaused; // 奖励领取暂停开关（紧急情况下禁止领取奖励）

    IERC20 public MetaNode; // MetaNode奖励代币合约实例

    uint256 public totalPoolWeight; // 总池权重（所有池权重之和，用于计算单池奖励占比）
    Pool[] public pool; // 质押池列表（索引即池ID，pid）

    mapping(uint256 => mapping(address => User)) public user; // 用户质押信息映射（pid => 地址 => 用户信息）

    // 事件定义
    event SetMetaNode(IERC20 indexed MetaNode);
    event PauseWithdraw();
    event UnpauseWithdraw();
    event PauseClaim();
    event UnpauseClaim();
    event SetStartBlock(uint256 indexed startBlock);
    event SetEndBlock(uint256 indexed endBlock);
    event SetMetaNodePerBlock(uint256 indexed MetaNodePerBlock);
    event AddPool(
        address indexed stTokenAddress,
        uint256 indexed poolWeight,
        uint256 indexed lastRewardBlock,
        uint256 minDepositAmount,
        uint256 unstakeLockedBlocks
    );
    event UpdatePoolInfo(
        uint256 indexed poolId,
        uint256 indexed minDepositAmount,
        uint256 indexed unstakeLockedBlocks
    );
    event SetPoolWeight(
        uint256 indexed poolId,
        uint256 indexed poolWeight,
        uint256 totalPoolWeight
    );
    event UpdatePool(
        uint256 indexed poolId,
        uint256 indexed lastRewardBlock,
        uint256 totalMetaNode
    );
    event Deposit(address indexed user, uint256 indexed poolId, uint256 amount);
    event RequestUnstake(
        address indexed user,
        uint256 indexed poolId,
        uint256 amount
    );
    event Withdraw(
        address indexed user,
        uint256 indexed poolId,
        uint256 amount,
        uint256 indexed blockNumber
    );
    event Claim(
        address indexed user,
        uint256 indexed poolId,
        uint256 MetaNodeReward
    );

    // 修饰器
    modifier checkPid(uint256 _pid) {
        require(_pid < pool.length, "invalid pid"); // 校验池ID在有效范围内
        _;
    }

    modifier whenNotClaimPaused() {
        require(!claimPaused, "claim is paused"); // 校验奖励领取功能未暂停
        _;
    }

    modifier whenNotWithdrawPaused() {
        require(!withdrawPaused, "withdraw is paused"); // 校验提取功能未暂停
        _;
    }

    /**
     * @notice 合约初始化函数（仅代理部署时执行一次）
     * @param _MetaNode MetaNode奖励代币地址
     * @param _startBlock 奖励开始区块号
     * @param _endBlock 奖励结束区块号
     * @param _MetaNodePerBlock 每区块奖励量
     */
    function initialize(
        IERC20 _MetaNode,
        uint256 _startBlock,
        uint256 _endBlock,
        uint256 _MetaNodePerBlock
    ) public initializer {
        // 校验核心参数合法性：开始区块不能晚于结束区块，且每区块奖励需大于0
        require(
            _startBlock <= _endBlock && _MetaNodePerBlock > 0,
            "invalid parameters"
        );

        // 初始化继承的升级合约和权限合约
        __AccessControl_init();
        __UUPSUpgradeable_init();
        // 授予部署者默认管理员、升级者和管理员角色（最小权限原则后续可回收）
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(UPGRADE_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);

        // 设置奖励代币并初始化奖励时间参数
        setMetaNode(_MetaNode);
        startBlock = _startBlock;
        endBlock = _endBlock;
        MetaNodePerBlock = _MetaNodePerBlock;
    }

    /**
     * @notice 合约升级授权函数（UUPS升级模式必需）
     * @dev 仅允许UPGRADE_ROLE角色执行，限制升级权限
     * @param newImplementation 新的合约实现地址
     */
    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyRole(UPGRADE_ROLE) {}

    // 管理员函数
    /**
     * @notice 设置MetaNode奖励代币地址
     * @dev 仅管理员可执行，用于更新奖励代币合约（如代币合约升级）
     * @param _MetaNode 新的MetaNode代币地址
     */
    function setMetaNode(IERC20 _MetaNode) public onlyRole(ADMIN_ROLE) {
        MetaNode = _MetaNode;
        emit SetMetaNode(MetaNode);
    }

    /**
     * @notice 暂停提取功能
     * @dev 仅管理员可执行，紧急情况下（如合约漏洞）禁止用户提取资金
     */
    function pauseWithdraw() public onlyRole(ADMIN_ROLE) {
        require(!withdrawPaused, "withdraw has been already paused"); // 防止重复暂停
        withdrawPaused = true;
        emit PauseWithdraw();
    }

    /**
     * @notice 解除提取功能暂停
     * @dev 仅管理员可执行，恢复正常提取功能
     */
    function unpauseWithdraw() public onlyRole(ADMIN_ROLE) {
        require(withdrawPaused, "withdraw has been already unpaused"); // 防止重复解除暂停
        withdrawPaused = false;
        emit UnpauseWithdraw();
    }

    /**
     * @notice 暂停奖励领取功能
     * @dev 仅管理员可执行，紧急情况下禁止用户领取奖励
     */
    function pauseClaim() public onlyRole(ADMIN_ROLE) {
        require(!claimPaused, "claim has been already paused"); // 防止重复暂停
        claimPaused = true;
        emit PauseClaim();
    }

    /**
     * @notice 解除奖励领取功能暂停
     * @dev 仅管理员可执行，恢复正常奖励领取
     */
    function unpauseClaim() public onlyRole(ADMIN_ROLE) {
        require(claimPaused, "claim has been already unpaused"); // 防止重复解除暂停
        claimPaused = false;
        emit UnpauseClaim();
    }

    /**
     * @notice 更新奖励开始区块号
     * @dev 仅管理员可执行，需确保新开始区块不晚于结束区块
     * @param _startBlock 新的奖励开始区块号
     */
    function setStartBlock(uint256 _startBlock) public onlyRole(ADMIN_ROLE) {
        require(
            _startBlock <= endBlock,
            "start block must be smaller than end block"
        );
        startBlock = _startBlock;
        emit SetStartBlock(_startBlock);
    }

    /**
     * @notice 更新奖励结束区块号
     * @dev 仅管理员可执行，需确保新结束区块不早于开始区块
     * @param _endBlock 新的奖励结束区块号
     */
    function setEndBlock(uint256 _endBlock) public onlyRole(ADMIN_ROLE) {
        require(
            startBlock <= _endBlock,
            "start block must be smaller than end block"
        );
        endBlock = _endBlock;
        emit SetEndBlock(_endBlock);
    }

    /**
     * @notice 更新每区块MetaNode奖励量
     * @dev 仅管理员可执行，奖励量需大于0以保证奖励机制有效
     * @param _MetaNodePerBlock 新的每区块奖励量
     */
    function setMetaNodePerBlock(
        uint256 _MetaNodePerBlock
    ) public onlyRole(ADMIN_ROLE) {
        require(_MetaNodePerBlock > 0, "invalid parameter"); // 奖励量不能为0
        MetaNodePerBlock = _MetaNodePerBlock;
        emit SetMetaNodePerBlock(_MetaNodePerBlock);
    }

    /**
     * @notice 添加新质押池
     * @dev 仅管理员可执行，首个池必须是ETH池（地址0），禁止重复添加同一代币
     * @param _stTokenAddress 质押代币地址（ETH池为address(0)）
     * @param _poolWeight 池权重（决定奖励分配比例）
     * @param _minDepositAmount 最小质押金额
     * @param _unstakeLockedBlocks 解锁锁定区块数（必须>0）
     * @param _withUpdate 是否先更新所有池奖励（确保奖励计算连续）
     */
    function addPool(
        address _stTokenAddress,
        uint256 _poolWeight,
        uint256 _minDepositAmount,
        uint256 _unstakeLockedBlocks,
        bool _withUpdate
    ) public onlyRole(ADMIN_ROLE) {
        // 检查代币地址唯一性：避免同一代币重复创建池，导致奖励分配混乱
        for (uint256 i = 0; i < pool.length; i++) {
            require(
                pool[i].stTokenAddress != _stTokenAddress,
                "duplicate staking token"
            );
        }

        // 首个池必须是ETH池（地址0），后续池不能是ETH池（ETH仅允许一个池）
        if (pool.length > 0) {
            require(
                _stTokenAddress != address(0x0),
                "invalid staking token address (not first pool)"
            );
        } else {
            require(
                _stTokenAddress == address(0x0),
                "invalid staking token address (first pool must be ETH)"
            );
        }

        require(_unstakeLockedBlocks > 0, "invalid withdraw locked blocks"); // 锁定区块数必须>0，否则解锁无延迟
        require(block.number < endBlock, "Already ended"); // 奖励已结束的情况下不允许添加新池

        // 如需更新，先更新所有池的奖励状态（确保新池添加前的奖励已计算）
        if (_withUpdate) {
            massUpdatePools();
        }

        // 初始奖励计算区块号：取当前区块和开始区块的较大值（未到开始区块则从开始区块起算）
        uint256 lastRewardBlock = block.number > startBlock
            ? block.number
            : startBlock;
        totalPoolWeight += _poolWeight; // 更新总权重

        // 添加新池到列表
        pool.push(
            Pool({
                stTokenAddress: _stTokenAddress,
                poolWeight: _poolWeight,
                lastRewardBlock: lastRewardBlock,
                accMetaNodePerST: 0,
                stTokenAmount: 0,
                minDepositAmount: _minDepositAmount,
                unstakeLockedBlocks: _unstakeLockedBlocks
            })
        );

        emit AddPool(
            _stTokenAddress,
            _poolWeight,
            lastRewardBlock,
            _minDepositAmount,
            _unstakeLockedBlocks
        );
    }

    /**
     * @notice 更新质押池基础信息（最小质押额和锁定区块数）
     * @dev 仅管理员可执行，用于调整池的质押规则
     * @param _pid 池ID
     * @param _minDepositAmount 新的最小质押金额
     * @param _unstakeLockedBlocks 新的解锁锁定区块数
     */
    function updatePool(
        uint256 _pid,
        uint256 _minDepositAmount,
        uint256 _unstakeLockedBlocks
    ) public onlyRole(ADMIN_ROLE) checkPid(_pid) {
        pool[_pid].minDepositAmount = _minDepositAmount;
        pool[_pid].unstakeLockedBlocks = _unstakeLockedBlocks;
        emit UpdatePoolInfo(_pid, _minDepositAmount, _unstakeLockedBlocks);
    }

    /**
     * @notice 设置质押池权重（影响奖励分配比例）
     * @dev 仅管理员可执行，需先更新奖励状态以避免权重变更影响历史奖励
     * @param _pid 池ID
     * @param _poolWeight 新的池权重（必须>0）
     * @param _withUpdate 是否先更新所有池奖励
     */
    function setPoolWeight(
        uint256 _pid,
        uint256 _poolWeight,
        bool _withUpdate
    ) public onlyRole(ADMIN_ROLE) checkPid(_pid) {
        require(_poolWeight > 0, "invalid pool weight"); // 权重不能为0，否则该池无奖励

        // 如需更新，先更新所有池的奖励状态（确保权重变更前的奖励已按旧权重计算）
        if (_withUpdate) {
            massUpdatePools();
        }

        // 更新总权重：减去旧权重，加上新权重
        totalPoolWeight = totalPoolWeight - pool[_pid].poolWeight + _poolWeight;
        pool[_pid].poolWeight = _poolWeight;
        emit SetPoolWeight(_pid, _poolWeight, totalPoolWeight);
    }

    // 查询函数
    /**
     * @notice 获取质押池总数
     * @return 质押池的数量
     */
    function poolLength() external view returns (uint256) {
        return pool.length;
    }

    /**
     * @notice 计算区块区间奖励乘数（有效区块数 × 每区块奖励量）
     * @param _from 起始区块（包含）
     * @param _to 结束区块（不包含）
     * @return 奖励乘数（该区间内可分配的总奖励基数）
     */
    function getMultiplier(
        uint256 _from,
        uint256 _to
    ) public view returns (uint256) {
        require(_from <= _to, "invalid block"); // 起始区块不能晚于结束区块
        // 修正区间：仅计算[startBlock, endBlock]内的区块
        if (_from < startBlock) _from = startBlock; // 起始区块早于奖励开始，从开始区块起算
        if (_to > endBlock) _to = endBlock; // 结束区块晚于奖励结束，到结束区块为止
        require(_from <= _to, "end block must be greater than start block"); // 修正后仍需保证区间有效
        return (_to - _from) * MetaNodePerBlock; // 计算乘数（Solidity 0.8+自动溢出检查）
    }

    /**
     * @notice 查询用户在指定池的当前待领取MetaNode奖励
     * @param _pid 池ID
     * @param _user 用户地址
     * @return 待领取的奖励金额
     */
    function pendingMetaNode(
        uint256 _pid,
        address _user
    ) external view checkPid(_pid) returns (uint256) {
        return _calculatePendingReward(_pid, _user, block.number); // 以当前区块计算
    }

    /**
     * @notice 按指定区块号查询用户在指定池的待领取MetaNode奖励
     * @param _pid 池ID
     * @param _user 用户地址
     * @param _blockNumber 指定的计算区块号
     * @return 待领取的奖励金额
     */
    function pendingMetaNodeByBlockNumber(
        uint256 _pid,
        address _user,
        uint256 _blockNumber
    ) public view checkPid(_pid) returns (uint256) {
        return _calculatePendingReward(_pid, _user, _blockNumber); // 以指定区块计算
    }

    /**
     * @notice 提取奖励计算公共逻辑（减少重复代码）
     * @param _pid 池ID
     * @param _user 用户地址
     * @param _blockNumber 计算区块号
     * @return 待领取奖励金额
     */
    function _calculatePendingReward(
        uint256 _pid,
        address _user,
        uint256 _blockNumber
    ) internal view returns (uint256) {
        Pool storage pool_ = pool[_pid];
        User storage user_ = user[_pid][_user];
        uint256 accMetaNodePerST = pool_.accMetaNodePerST; // 当前池的累积奖励系数
        uint256 stSupply = pool_.stTokenAmount; // 当前池的总质押量

        // 如果指定区块晚于上次奖励计算区块，且池中有质押，需临时计算累积奖励系数
        if (_blockNumber > pool_.lastRewardBlock && stSupply != 0) {
            uint256 multiplier = getMultiplier(
                pool_.lastRewardBlock,
                _blockNumber
            ); // 计算区间奖励乘数
            uint256 MetaNodeForPool = (multiplier * pool_.poolWeight) /
                totalPoolWeight; // 该池应得奖励（按权重分配）
            accMetaNodePerST += (MetaNodeForPool * (1 ether)) / stSupply; // 更新累积奖励系数（放大1e18倍）
        }

        // 计算用户待领取奖励：（用户质押量 × 累积系数 ÷ 1e18） - 已发放奖励 + 暂存待领取奖励
        return
            (user_.stAmount * accMetaNodePerST) /
            (1 ether) -
            user_.finishedMetaNode +
            user_.pendingMetaNode;
    }

    /**
     * @notice 查询用户在指定池的质押余额
     * @param _pid 池ID
     * @param _user 用户地址
     * @return 用户的质押金额
     */
    function stakingBalance(
        uint256 _pid,
        address _user
    ) external view checkPid(_pid) returns (uint256) {
        return user[_pid][_user].stAmount;
    }

    /**
     * @notice 查询用户在指定池的解锁申请信息
     * @param _pid 池ID
     * @param _user 用户地址
     * @return requestAmount 总申请解锁金额，pendingWithdrawAmount 已解锁可提取金额
     */
    function withdrawAmount(
        uint256 _pid,
        address _user
    )
        public
        view
        checkPid(_pid)
        returns (uint256 requestAmount, uint256 pendingWithdrawAmount)
    {
        User storage user_ = user[_pid][_user];
        // 遍历所有解锁申请，累加总申请金额和已解锁金额
        for (uint256 i = 0; i < user_.requests.length; i++) {
            if (user_.requests[i].unlockBlocks <= block.number) {
                // 已到解锁时间
                pendingWithdrawAmount += user_.requests[i].amount;
            }
            requestAmount += user_.requests[i].amount; // 累加所有申请金额
        }
    }

    // 公共函数
    /**
     * @notice 更新指定池的奖励状态（计算区间奖励并更新累积系数）
     * @param _pid 池ID
     */
    function updatePool(uint256 _pid) public checkPid(_pid) {
        Pool storage pool_ = pool[_pid];
        // 如果当前区块未超过上次奖励计算区块，无需更新（奖励未新增）
        if (block.number <= pool_.lastRewardBlock) return;

        // 计算从上一次奖励计算到当前区块的奖励乘数
        uint256 multiplier = getMultiplier(pool_.lastRewardBlock, block.number);
        // 计算该池应得的奖励总量（乘数 × 池权重 ÷ 总权重）
        uint256 totalMetaNode = (multiplier * pool_.poolWeight) /
            totalPoolWeight;

        uint256 stSupply = pool_.stTokenAmount;
        // 如果池中有质押，更新累积奖励系数（总奖励 × 1e18 ÷ 总质押量）
        if (stSupply > 0) {
            uint256 totalMetaNode_ = (totalMetaNode * (1 ether)) / stSupply;
            pool_.accMetaNodePerST += totalMetaNode_; // 累加至累积系数
        }

        // 更新上次奖励计算区块号为当前区块（下次从当前区块开始计算）
        pool_.lastRewardBlock = block.number;
        emit UpdatePool(_pid, pool_.lastRewardBlock, totalMetaNode);
    }

    /**
     * @notice 更新所有池的奖励状态（批量更新）
     * @dev 遍历所有池并调用updatePool，注意：池数量过多时可能超出区块gas限制
     */
    function massUpdatePools() public {
        uint256 length = pool.length;
        for (uint256 pid = 0; pid < length; pid++) {
            updatePool(pid);
        }
    }

    /**
     * @notice 质押ETH获取MetaNode奖励（仅ETH池可用）
     * @dev 用户需发送ETH作为质押金，质押金额为msg.value
     */
    function depositETH() public payable whenNotPaused {
        Pool storage pool_ = pool[ETH_PID];
        // 校验当前池是ETH池（地址0），防止在非ETH池调用
        require(
            pool_.stTokenAddress == address(0x0),
            "invalid staking token address"
        );

        uint256 _amount = msg.value; // 质押金额为用户发送的ETH数量
        // 校验质押金额不小于最小质押金额（防止小额质押）
        require(
            _amount >= pool_.minDepositAmount,
            "deposit amount is too small"
        );

        _deposit(ETH_PID, _amount); // 调用内部质押函数处理核心逻辑
    }

    /**
     * @notice 质押ERC20代币获取MetaNode奖励（非ETH池可用）
     * @dev 用户需先授权合约转移质押代币，质押金额需>=最小质押额
     * @param _pid 池ID（非ETH池）
     * @param _amount 质押金额
     */
    function deposit(
        uint256 _pid,
        uint256 _amount
    ) public whenNotPaused checkPid(_pid) {
        require(_pid != 0, "deposit not support ETH staking"); // 禁止在ETH池使用此函数（需用depositETH）
        Pool storage pool_ = pool[_pid];
        // 校验质押金额不小于最小质押金额（与ETH质押保持一致）
        require(
            _amount >= pool_.minDepositAmount,
            "deposit amount is too small"
        );

        if (_amount > 0) {
            // 检查用户授权额度是否充足，提前发现授权不足问题
            require(
                IERC20(pool_.stTokenAddress).allowance(
                    msg.sender,
                    address(this)
                ) >= _amount,
                "insufficient allowance"
            );
            // 从用户地址转移代币到合约（使用SafeERC20确保转账安全）
            IERC20(pool_.stTokenAddress).safeTransferFrom(
                msg.sender,
                address(this),
                _amount
            );
        }

        _deposit(_pid, _amount); // 调用内部质押函数处理核心逻辑
    }

    /**
     * @notice 申请解锁质押资产（发起解锁，需等待锁定区块后才能提取）
     * @dev 解锁时会计算当前待领取奖励并暂存，减少用户质押余额和池总质押量
     * @param _pid 池ID
     * @param _amount 申请解锁金额
     */
    function unstake(
        uint256 _pid,
        uint256 _amount
    ) public whenNotPaused checkPid(_pid) whenNotWithdrawPaused {
        Pool storage pool_ = pool[_pid];
        User storage user_ = user[_pid][msg.sender];

        // 校验用户质押余额充足（解锁金额不能超过当前质押量）
        require(user_.stAmount >= _amount, "Not enough staking token balance");
        // 更新当前池的奖励状态（确保解锁前的奖励已计算）
        updatePool(_pid);

        // 计算用户当前待领取奖励（累计应得奖励 - 已发放奖励）
        uint256 pendingMetaNode_ = (user_.stAmount * pool_.accMetaNodePerST) /
            (1 ether) -
            user_.finishedMetaNode;
        // 如有待领取奖励，暂存至pendingMetaNode（用户可后续领取）
        if (pendingMetaNode_ > 0) {
            user_.pendingMetaNode += pendingMetaNode_;
        }

        if (_amount > 0) {
            user_.stAmount -= _amount; // 减少用户质押余额
            // 添加解锁申请：解锁区块 = 当前区块 + 锁定区块数（需等待指定区块后才能提取）
            user_.requests.push(
                UnstakeRequest({
                    amount: _amount,
                    unlockBlocks: block.number + pool_.unstakeLockedBlocks
                })
            );
        }

        pool_.stTokenAmount -= _amount; // 减少池的总质押量
        // 更新用户已发放奖励记录（基于当前累积奖励系数，避免重复计算）
        user_.finishedMetaNode =
            (user_.stAmount * pool_.accMetaNodePerST) /
            (1 ether);
        emit RequestUnstake(msg.sender, _pid, _amount);
    }

    /**
     * @notice 提取已解锁的质押资产（领取所有已到解锁时间的申请）
     * @dev 遍历所有解锁申请，提取已解锁部分，保留未解锁申请
     * @param _pid 池ID
     */
    function withdraw(
        uint256 _pid
    ) public whenNotPaused checkPid(_pid) whenNotWithdrawPaused {
        Pool storage pool_ = pool[_pid];
        User storage user_ = user[_pid][msg.sender];

        uint256 pendingWithdraw_ = 0; // 已解锁可提取金额
        // 临时数组存储未解锁的申请（避免直接修改原数组导致遍历异常）
        UnstakeRequest[] memory newRequests = new UnstakeRequest[](
            user_.requests.length
        );
        uint256 newIndex = 0; // 未解锁申请的索引

        // 遍历所有解锁申请，分离已解锁和未解锁部分（不假设申请顺序）
        for (uint256 i = 0; i < user_.requests.length; i++) {
            if (user_.requests[i].unlockBlocks <= block.number) {
                // 已到解锁时间
                pendingWithdraw_ += user_.requests[i].amount;
            } else {
                // 未到解锁时间，暂存至新数组
                newRequests[newIndex] = user_.requests[i];
                newIndex++;
            }
        }

        // 更新申请列表：清空原列表，添加未解锁申请
        delete user_.requests;
        for (uint256 i = 0; i < newIndex; i++) {
            user_.requests.push(newRequests[i]);
        }

        // 如有可提取金额，转账给用户
        if (pendingWithdraw_ > 0) {
            if (pool_.stTokenAddress == address(0x0)) {
                // ETH池：直接转账ETH（使用安全转账函数）
                _safeETHTransfer(msg.sender, pendingWithdraw_);
            } else {
                // ERC20池：转账质押代币（使用SafeERC20确保安全）
                IERC20(pool_.stTokenAddress).safeTransfer(
                    msg.sender,
                    pendingWithdraw_
                );
            }
        }

        emit Withdraw(msg.sender, _pid, pendingWithdraw_, block.number);
    }

    /**
     * @notice 领取MetaNode奖励（提取当前所有待领取奖励）
     * @dev 计算并转账奖励，更新已发放奖励记录
     * @param _pid 池ID
     */
    function claim(
        uint256 _pid
    ) public whenNotPaused checkPid(_pid) whenNotClaimPaused {
        Pool storage pool_ = pool[_pid];
        User storage user_ = user[_pid][msg.sender];

        // 更新当前池的奖励状态（确保最新奖励已计算）
        updatePool(_pid);
        // 计算总待领取奖励：（当前累积应得 - 已发放） + 之前暂存的待领取
        uint256 pendingMetaNode_ = (user_.stAmount * pool_.accMetaNodePerST) /
            (1 ether) -
            user_.finishedMetaNode +
            user_.pendingMetaNode;

        // 如有待领取奖励，转账给用户并重置暂存奖励
        if (pendingMetaNode_ > 0) {
            user_.pendingMetaNode = 0; // 清空暂存奖励
            _safeMetaNodeTransfer(msg.sender, pendingMetaNode_); // 安全转账奖励
        }

        // 更新用户已发放奖励记录（基于当前累积奖励系数）
        user_.finishedMetaNode =
            (user_.stAmount * pool_.accMetaNodePerST) /
            (1 ether);
        emit Claim(msg.sender, _pid, pendingMetaNode_);
    }

    /**
     * @notice 合约把奖励代币转出（测试用）
     * @param _to 转账地址
     * @param _amount 转出金额
     */
    function safeTransferMetaNode(
        address _to,
        uint256 _amount
    ) public onlyRole(ADMIN_ROLE) {
        _safeMetaNodeTransfer(_to, _amount);
    }

    // 内部函数
    /**
     * @notice 内部质押处理函数（统一处理ETH和ERC20质押的核心逻辑）
     * @param _pid 池ID
     * @param _amount 质押金额
     */
    function _deposit(uint256 _pid, uint256 _amount) internal {
        Pool storage pool_ = pool[_pid];
        User storage user_ = user[_pid][msg.sender];

        // 更新当前池的奖励状态（确保质押前的奖励已计算）
        updatePool(_pid);

        // 如果用户已有质押余额，计算并暂存待领取奖励（避免质押后奖励被覆盖）
        if (user_.stAmount > 0) {
            uint256 accST = (user_.stAmount * pool_.accMetaNodePerST) /
                (1 ether); // 累计应得奖励
            uint256 pendingMetaNode_ = accST - user_.finishedMetaNode; // 待领取奖励 = 累计应得 - 已发放
            if (pendingMetaNode_ > 0) {
                user_.pendingMetaNode += pendingMetaNode_; // 暂存待领取奖励
            }
        }

        // 如质押金额>0，增加用户质押余额
        if (_amount > 0) {
            user_.stAmount += _amount;
        }

        // 增加池的总质押量（反映最新质押情况）
        pool_.stTokenAmount += _amount;
        // 更新用户已发放奖励记录（基于当前累积奖励系数，避免重复计算）
        user_.finishedMetaNode =
            (user_.stAmount * pool_.accMetaNodePerST) /
            (1 ether);
        emit Deposit(msg.sender, _pid, _amount);
    }

    /**
     * @notice 安全转账MetaNode奖励（确保奖励足额发放）
     * @dev 检查合约奖励代币余额，不足时revert（避免用户奖励被克扣）
     * @param _to 接收奖励的地址
     * @param _amount 计划转账的奖励金额
     */
    function _safeMetaNodeTransfer(address _to, uint256 _amount) internal {
        uint256 MetaNodeBal = MetaNode.balanceOf(address(this)); // 获取合约当前奖励代币余额
        // 校验合约余额充足，不足时revert（需管理员补充代币后再领取）
        require(
            _amount <= MetaNodeBal,
            "insufficient MetaNode balance in contract"
        );
        MetaNode.transfer(_to, _amount); // 转账奖励
    }

    /**
     * @notice 安全转账ETH（处理ETH转账并验证结果）
     * @dev 使用低级别call转账ETH，校验转账成功与否
     * @param _to 接收ETH的地址
     * @param _amount 转账的ETH金额
     */
    function _safeETHTransfer(address _to, uint256 _amount) internal {
        // 低级别调用转账ETH（支持接收ETH的合约地址）
        (bool success, bytes memory data) = address(_to).call{value: _amount}(
            ""
        );
        require(success, "ETH transfer call failed"); // 校验调用是否成功
        // 如接收方返回数据，需校验返回结果为true（部分合约要求）
        if (data.length > 0) {
            require(
                abi.decode(data, (bool)),
                "ETH transfer operation did not succeed"
            );
        }
    }

    // ========== 接收ETH（用于ETH质押） ==========
    receive() external payable {
        // 禁止直接向合约转账ETH，必须通过stakeEth函数
        revert("please use stakeEth function to stake ETH");
    }
}
