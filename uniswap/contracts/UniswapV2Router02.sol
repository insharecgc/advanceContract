// SPDX-License-Identifier: MIT
pragma solidity =0.6.6;

// 导入Uniswap V2核心工厂合约接口（用于调用工厂方法如创建交易对、查询储备等）
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
// 导入TransferHelper库（封装安全转账逻辑，避免重复代码）
import "@uniswap/lib/contracts/libraries/TransferHelper.sol";

// 导入当前合约要实现的接口（确保遵循Router02的方法规范）
import "./interfaces/IUniswapV2Router02.sol";
// 导入Uniswap V2核心工具库（提供交易对地址计算、金额换算等核心逻辑）
import "./libraries/UniswapV2Library.sol";
// 导入SafeMath库（处理uint类型的安全数学运算，防止溢出/下溢）
import "./libraries/SafeMath.sol";
// 导入ERC20标准接口（用于调用代币的transfer、balanceOf等方法）
import "./interfaces/IERC20.sol";
// 导入WETH接口（用于ETH与WETH的相互转换）
import "./interfaces/IWETH.sol";

/**
 * @title UniswapV2Router02
 * @notice Uniswap V2协议的外围路由合约，提供流动性管理和代币交换的高级接口
 * @dev 实现IUniswapV2Router02接口
 */
contract UniswapV2Router02 is IUniswapV2Router02 {
    // 引入SafeMath库，对uint类型的所有操作自动应用安全数学运算
    using SafeMath for uint;

    /**
     * @notice Uniswap V2工厂合约地址（不可变，部署后固定）
     * @dev 用于创建交易对、查询交易对储备等核心操作
     */
    address public immutable override factory;

    /**
     * @notice WETH合约地址（不可变，部署后固定）
     * @dev 用于ETH与WETH的转换（ETH本身不支持ERC20接口，需包装为WETH才能参与交易对）
     */
    address public immutable override WETH;

    /**
     * @notice 操作有效期修饰器（防止交易超时执行）
     * @param deadline 操作截止时间戳（UNIX时间）
     * @dev 若当前区块时间超过deadline，将回滚交易并抛出异常
     */
    modifier ensure(uint deadline) {
        require(deadline >= block.timestamp, "UniswapV2Router: EXPIRED");
        _; // 执行被修饰的函数
    }

    /**
     * @notice 构造函数（初始化工厂和WETH地址）
     * @param _factory Uniswap V2工厂合约地址
     * @param _WETH WETH合约地址
     * @dev 部署时需传入合法的工厂和WETH地址，且不可修改
     */
    constructor(address _factory, address _WETH) public {
        factory = _factory;
        WETH = _WETH;
    }

    /**
     * @notice 接收ETH的回调函数（仅用于WETH合约的ETH退款）
     * @dev 限制仅能接收来自WETH合约的ETH转账（通过assert验证），防止意外接收ETH
     */
    receive() external payable {
        assert(msg.sender == WETH); // 仅允许WETH合约通过fallback转账ETH
    }

    // ======== 流动性添加相关函数 ========

    /**
     * @notice 内部辅助函数：计算添加流动性时的最优代币数量（核心逻辑）
     * @param tokenA 代币A地址
     * @param tokenB 代币B地址
     * @param amountADesired 期望添加的代币A数量
     * @param amountBDesired 期望添加的代币B数量
     * @param amountAMin 最小可接受的代币A数量（滑点保护）
     * @param amountBMin 最小可接受的代币B数量（滑点保护）
     * @return amountA 实际需要转移的代币A数量
     * @return amountB 实际需要转移的代币B数量
     * @dev 1. 若交易对不存在，自动通过工厂创建；2. 若为首次添加流动性，直接使用期望数量；3. 非首次添加时，按当前储备比例计算最优数量，确保流动性比例均衡
     */
    function _addLiquidity(
        address tokenA,
        address tokenB,
        uint amountADesired,
        uint amountBDesired,
        uint amountAMin,
        uint amountBMin
    ) internal virtual returns (uint amountA, uint amountB) {
        // 若交易对不存在，调用工厂合约创建新交易对
        if (IUniswapV2Factory(factory).getPair(tokenA, tokenB) == address(0)) {
            IUniswapV2Factory(factory).createPair(tokenA, tokenB);
        }
        // 获取交易对当前的代币储备量（reserveA对应tokenA，reserveB对应tokenB）
        (uint reserveA, uint reserveB) = UniswapV2Library.getReserves(
            factory,
            tokenA,
            tokenB
        );

        // 情况1：交易对为首次添加流动性（储备量均为0），直接使用期望数量
        if (reserveA == 0 && reserveB == 0) {
            (amountA, amountB) = (amountADesired, amountBDesired);
        } else {
            // 情况2：交易对已存在，计算amountADesired对应的最优代币B数量（按当前储备比例）
            uint amountBOptimal = UniswapV2Library.quote(
                amountADesired,
                reserveA,
                reserveB
            );

            // 若最优B数量 ≤ 期望B数量，使用期望A和最优B（满足滑点要求）
            if (amountBOptimal <= amountBDesired) {
                require(
                    amountBOptimal >= amountBMin,
                    "UniswapV2Router: INSUFFICIENT_B_AMOUNT"
                );
                (amountA, amountB) = (amountADesired, amountBOptimal);
            } else {
                // 若最优B数量 > 期望B数量，反向计算最优A数量，使用最优A和期望B（满足滑点要求）
                uint amountAOptimal = UniswapV2Library.quote(
                    amountBDesired,
                    reserveB,
                    reserveA
                );
                assert(amountAOptimal <= amountADesired); // 确保最优A不超过期望A（理论上必然成立）
                require(
                    amountAOptimal >= amountAMin,
                    "UniswapV2Router: INSUFFICIENT_A_AMOUNT"
                );
                (amountA, amountB) = (amountAOptimal, amountBDesired);
            }
        }
    }

    /**
     * @notice 公开函数：向ERC20-ERC20交易对添加流动性
     * @param tokenA 代币A地址（无需排序，工具库自动处理）
     * @param tokenB 代币B地址（无需排序）
     * @param amountADesired 期望添加的代币A数量
     * @param amountBDesired 期望添加的代币B数量
     * @param amountAMin 最小可接受的代币A数量（防止滑点过大导致损失）
     * @param amountBMin 最小可接受的代币B数量（防止滑点过大导致损失）
     * @param to 接收LP代币（流动性凭证）的地址
     * @param deadline 操作截止时间戳（超时后交易失效）
     * @return amountA 实际添加的代币A数量
     * @return amountB 实际添加的代币B数量
     * @return liquidity 获得的LP代币数量
     * @dev 1. 自动创建交易对（若不存在）；2. 从调用者地址转移代币到交易对；3. 调用交易对的mint方法发行LP代币
     */
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint amountADesired,
        uint amountBDesired,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    )
        external
        virtual
        override
        ensure(deadline)
        returns (uint amountA, uint amountB, uint liquidity)
    {
        // 调用内部函数计算实际添加的代币数量
        (amountA, amountB) = _addLiquidity(
            tokenA,
            tokenB,
            amountADesired,
            amountBDesired,
            amountAMin,
            amountBMin
        );
        // 计算交易对地址（通过工具库按字典序排序代币地址，确保唯一性）
        address pair = UniswapV2Library.pairFor(factory, tokenA, tokenB);
        // 从调用者地址安全转移代币A到交易对合约
        TransferHelper.safeTransferFrom(tokenA, msg.sender, pair, amountA);
        // 从调用者地址安全转移代币B到交易对合约
        TransferHelper.safeTransferFrom(tokenB, msg.sender, pair, amountB);
        // 调用交易对的mint方法，发行LP代币并发送到to地址
        liquidity = IUniswapV2Pair(pair).mint(to);
    }

    /**
     * @notice 公开函数：向ETH-ERC20交易对添加流动性（自动处理WETH转换）
     * @param token ERC20代币地址（与ETH配对）
     * @param amountTokenDesired 期望添加的ERC20代币数量
     * @param amountTokenMin 最小可接受的ERC20代币数量（滑点保护）
     * @param amountETHMin 最小可接受的ETH数量（滑点保护）
     * @param to 接收LP代币的地址
     * @param deadline 操作截止时间戳
     * @return amountToken 实际添加的ERC20代币数量
     * @return amountETH 实际添加的ETH数量
     * @return liquidity 获得的LP代币数量
     * @dev 1. 接收调用者发送的ETH，自动包装为WETH；2. 多余的ETH将退还调用者；3. 本质是调用addLiquidity（token-WETH交易对）
     */
    function addLiquidityETH(
        address token,
        uint amountTokenDesired,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline
    )
        external
        payable
        virtual
        override
        ensure(deadline)
        returns (uint amountToken, uint amountETH, uint liquidity)
    {
        // 调用内部_addLiquidity，将ETH视为WETH处理（msg.value为期望添加的ETH数量）
        (amountToken, amountETH) = _addLiquidity(
            token,
            WETH,
            amountTokenDesired,
            msg.value,
            amountTokenMin,
            amountETHMin
        );
        // 计算token-WETH交易对地址
        address pair = UniswapV2Library.pairFor(factory, token, WETH);
        // 从调用者地址转移ERC20代币到交易对
        TransferHelper.safeTransferFrom(token, msg.sender, pair, amountToken);
        // 将实际需要的ETH包装为WETH（存入WETH合约）
        IWETH(WETH).deposit{value: amountETH}();
        // 验证WETH转移到交易对的操作是否成功（assert确保执行，失败则回滚）
        assert(IWETH(WETH).transfer(pair, amountETH));
        // 发行LP代币并发送到to地址
        liquidity = IUniswapV2Pair(pair).mint(to);
        // 若调用者发送的ETH超过实际需要的数量，退还多余部分
        if (msg.value > amountETH)
            TransferHelper.safeTransferETH(msg.sender, msg.value - amountETH);
    }

    // ======== 流动性移除相关函数 ========

    /**
     * @notice 公开函数：从ERC20-ERC20交易对移除流动性
     * @param tokenA 代币A地址
     * @param tokenB 代币B地址
     * @param liquidity 要销毁的LP代币数量
     * @param amountAMin 最小可接受的代币A提取数量（滑点保护）
     * @param amountBMin 最小可接受的代币B提取数量（滑点保护）
     * @param to 接收提取代币的地址
     * @param deadline 操作截止时间戳
     * @return amountA 实际提取的代币A数量
     * @return amountB 实际提取的代币B数量
     * @dev 1. 从调用者地址转移LP代币到交易对；2. 调用交易对的burn方法销毁LP并提取代币；3. 验证提取数量满足滑点要求
     */
    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint liquidity,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    )
        public
        virtual
        override
        ensure(deadline)
        returns (uint amountA, uint amountB)
    {
        // 计算交易对地址
        address pair = UniswapV2Library.pairFor(factory, tokenA, tokenB);
        // 从调用者地址转移LP代币到交易对合约（准备销毁）
        IUniswapV2Pair(pair).transferFrom(msg.sender, pair, liquidity);
        // 调用交易对的burn方法，销毁LP代币并提取代币到to地址，返回提取的代币数量（amount0对应token0，amount1对应token1）
        (uint amount0, uint amount1) = IUniswapV2Pair(pair).burn(to);
        // 按字典序排序tokenA和tokenB，确定token0和token1
        (address token0, ) = UniswapV2Library.sortTokens(tokenA, tokenB);
        // 根据tokenA是否为token0，映射提取的代币数量
        (amountA, amountB) = tokenA == token0
            ? (amount0, amount1)
            : (amount1, amount0);
        // 验证提取的代币A数量满足最小要求
        require(
            amountA >= amountAMin,
            "UniswapV2Router: INSUFFICIENT_A_AMOUNT"
        );
        // 验证提取的代币B数量满足最小要求
        require(
            amountB >= amountBMin,
            "UniswapV2Router: INSUFFICIENT_B_AMOUNT"
        );
    }

    /**
     * @notice 公开函数：从ETH-ERC20交易对移除流动性（自动处理WETH转换）
     * @param token ERC20代币地址（与ETH配对）
     * @param liquidity 要销毁的LP代币数量
     * @param amountTokenMin 最小可接受的ERC20代币提取数量
     * @param amountETHMin 最小可接受的ETH提取数量
     * @param to 接收提取资产的地址
     * @param deadline 操作截止时间戳
     * @return amountToken 实际提取的ERC20代币数量
     * @return amountETH 实际提取的ETH数量
     * @dev 1. 先提取WETH，再解包为ETH；2. 本质是调用removeLiquidity（token-WETH交易对）
     */
    function removeLiquidityETH(
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline
    )
        public
        virtual
        override
        ensure(deadline)
        returns (uint amountToken, uint amountETH)
    {
        // 调用removeLiquidity提取token和WETH，先将资产转移到当前路由合约
        (amountToken, amountETH) = removeLiquidity(
            token,
            WETH,
            liquidity,
            amountTokenMin,
            amountETHMin,
            address(this),
            deadline
        );
        // 将提取的ERC20代币转移到to地址
        TransferHelper.safeTransfer(token, to, amountToken);
        // 将提取的WETH解包为ETH（从WETH合约取出ETH）
        IWETH(WETH).withdraw(amountETH);
        // 将ETH安全转移到to地址
        TransferHelper.safeTransferETH(to, amountETH);
    }

    /**
     * @notice 公开函数：带Permit授权的流动性移除（ERC20-ERC20）
     * @param tokenA 代币A地址
     * @param tokenB 代币B地址
     * @param liquidity 要销毁的LP代币数量
     * @param amountAMin 最小可接受的代币A提取数量
     * @param amountBMin 最小可接受的代币B提取数量
     * @param to 接收提取代币的地址
     * @param deadline 操作截止时间戳
     * @param approveMax 是否授权最大数量（true则授权uint(-1)，false则授权liquidity）
     * @param v ECDSA签名参数v
     * @param r ECDSA签名参数r
     * @param s ECDSA签名参数s
     * @return amountA 实际提取的代币A数量
     * @return amountB 实际提取的代币B数量
     * @dev 1. 无需提前调用approve授权LP代币，通过Permit签名直接授权；2. 适用于gas优化场景
     */
    function removeLiquidityWithPermit(
        address tokenA,
        address tokenB,
        uint liquidity,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline,
        bool approveMax,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external virtual override returns (uint amountA, uint amountB) {
        address pair = UniswapV2Library.pairFor(factory, tokenA, tokenB);
        // 确定授权数量：approveMax为true则授权最大uint值，否则授权liquidity数量
        uint value = approveMax ? uint(-1) : liquidity;
        // 调用LP代币的permit方法，通过签名授权当前路由合约转移LP代币
        IUniswapV2Pair(pair).permit(
            msg.sender,
            address(this),
            value,
            deadline,
            v,
            r,
            s
        );
        // 调用普通移除流动性函数完成操作
        (amountA, amountB) = removeLiquidity(
            tokenA,
            tokenB,
            liquidity,
            amountAMin,
            amountBMin,
            to,
            deadline
        );
    }

    /**
     * @notice 公开函数：带Permit授权的流动性移除（ETH-ERC20）
     * @param token ERC20代币地址
     * @param liquidity 要销毁的LP代币数量
     * @param amountTokenMin 最小可接受的ERC20代币提取数量
     * @param amountETHMin 最小可接受的ETH提取数量
     * @param to 接收提取资产的地址
     * @param deadline 操作截止时间戳
     * @param approveMax 是否授权最大数量
     * @param v ECDSA签名参数v
     * @param r ECDSA签名参数r
     * @param s ECDSA签名参数s
     * @return amountToken 实际提取的ERC20代币数量
     * @return amountETH 实际提取的ETH数量
     * @dev 结合Permit授权和ETH-ERC20流动性移除逻辑
     */
    function removeLiquidityETHWithPermit(
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline,
        bool approveMax,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external virtual override returns (uint amountToken, uint amountETH) {
        address pair = UniswapV2Library.pairFor(factory, token, WETH);
        uint value = approveMax ? uint(-1) : liquidity;
        // 调用LP代币的permit方法授权
        IUniswapV2Pair(pair).permit(
            msg.sender,
            address(this),
            value,
            deadline,
            v,
            r,
            s
        );
        // 调用ETH-ERC20流动性移除函数
        (amountToken, amountETH) = removeLiquidityETH(
            token,
            liquidity,
            amountTokenMin,
            amountETHMin,
            to,
            deadline
        );
    }

    /**
     * @notice 公开函数：支持fee-on-transfer代币的流动性移除（ETH-ERC20）
     * @param token ERC20代币地址（支持转账时扣除手续费）
     * @param liquidity 要销毁的LP代币数量
     * @param amountTokenMin 最小可接受的ERC20代币提取数量
     * @param amountETHMin 最小可接受的ETH提取数量
     * @param to 接收提取资产的地址
     * @param deadline 操作截止时间戳
     * @return amountETH 实际提取的ETH数量
     * @dev 1. 针对转账时扣除手续费的代币设计；2. 提取的ERC20代币数量以实际到账为准（扣除手续费后）
     */
    function removeLiquidityETHSupportingFeeOnTransferTokens(
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline
    ) public virtual override ensure(deadline) returns (uint amountETH) {
        // 调用removeLiquidity提取资产到当前路由合约
        (, amountETH) = removeLiquidity(
            token,
            WETH,
            liquidity,
            amountTokenMin,
            amountETHMin,
            address(this),
            deadline
        );
        // 转移路由合约中所有该ERC20代币到to地址（因可能有手续费，实际数量为余额）
        TransferHelper.safeTransfer(
            token,
            to,
            IERC20(token).balanceOf(address(this))
        );
        // 将WETH解包为ETH
        IWETH(WETH).withdraw(amountETH);
        // 转移ETH到to地址
        TransferHelper.safeTransferETH(to, amountETH);
    }

    /**
     * @notice 公开函数：带Permit授权且支持fee-on-transfer代币的流动性移除（ETH-ERC20）
     * @param token ERC20代币地址（支持转账扣手续费）
     * @param liquidity 要销毁的LP代币数量
     * @param amountTokenMin 最小可接受的ERC20代币提取数量
     * @param amountETHMin 最小可接受的ETH提取数量
     * @param to 接收提取资产的地址
     * @param deadline 操作截止时间戳
     * @param approveMax 是否授权最大数量
     * @param v ECDSA签名参数v
     * @param r ECDSA签名参数r
     * @param s ECDSA签名参数s
     * @return amountETH 实际提取的ETH数量
     * @dev 结合Permit授权、fee-on-transfer支持、ETH-ERC20流动性移除
     */
    function removeLiquidityETHWithPermitSupportingFeeOnTransferTokens(
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountETHMin,
        address to,
        uint deadline,
        bool approveMax,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external virtual override returns (uint amountETH) {
        address pair = UniswapV2Library.pairFor(factory, token, WETH);
        uint value = approveMax ? uint(-1) : liquidity;
        // Permit授权LP代币转移
        IUniswapV2Pair(pair).permit(
            msg.sender,
            address(this),
            value,
            deadline,
            v,
            r,
            s
        );
        // 调用支持fee-on-transfer的流动性移除函数
        amountETH = removeLiquidityETHSupportingFeeOnTransferTokens(
            token,
            liquidity,
            amountTokenMin,
            amountETHMin,
            to,
            deadline
        );
    }

    // ======== 代币交换相关函数 ========

    /**
     * @notice 内部辅助函数：执行多路径代币交换（核心逻辑）
     * @param amounts 各路径的代币数量数组（amounts[0]为输入数量，后续为各步输出数量）
     * @param path 交换路径数组（如[A, B, C]表示A→B→C）
     * @param _to 最终接收输出代币的地址
     * @dev 1. 遍历路径，依次执行每一步交换；2. 中间步骤的接收者为下一个交易对，最后一步为_to；3. 调用交易对的swap方法完成交换
     */
    function _swap(
        uint[] memory amounts,
        address[] memory path,
        address _to
    ) internal virtual {
        // 遍历交换路径（路径长度-1为交换次数）
        for (uint i; i < path.length - 1; i++) {
            // 当前步骤的输入代币和输出代币
            (address input, address output) = (path[i], path[i + 1]);
            // 按字典序排序输入/输出代币，确定token0
            (address token0, ) = UniswapV2Library.sortTokens(input, output);
            // 当前步骤的输出数量（从amounts数组获取）
            uint amountOut = amounts[i + 1];
            // 确定当前步骤的token0和token1输出数量（输入代币为token0则输出token1，反之亦然）
            (uint amount0Out, uint amount1Out) = input == token0
                ? (uint(0), amountOut)
                : (amountOut, uint(0));
            // 确定当前步骤的接收者：非最后一步则为下一个交易对地址，最后一步为目标地址_to
            address to = i < path.length - 2
                ? UniswapV2Library.pairFor(factory, output, path[i + 2])
                : _to;
            // 调用当前交易对的swap方法，执行交换
            IUniswapV2Pair(UniswapV2Library.pairFor(factory, input, output))
                .swap(
                    amount0Out,
                    amount1Out,
                    to,
                    new bytes(0) // 无额外回调数据
                );
        }
    }

    /**
     * @notice 公开函数：精确输入代币交换输出代币（ERC20-ERC20，支持多路径）
     * @param amountIn 输入代币的精确数量
     * @param amountOutMin 最小可接受的最终输出数量（滑点保护）
     * @param path 交换路径数组（如[A, B]表示A→B，[A, B, C]表示A→B→C）
     * @param to 接收最终输出代币的地址
     * @param deadline 操作截止时间戳
     * @return amounts 各步骤的代币数量数组（amounts[0]为输入，amounts[last]为最终输出）
     * @dev 1. 先计算各步骤输出数量；2. 转移输入代币到第一个交易对；3. 执行多路径交换
     */
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    )
        external
        virtual
        override
        ensure(deadline)
        returns (uint[] memory amounts)
    {
        // 计算交换路径中各步骤的输出数量（含0.3%手续费）
        amounts = UniswapV2Library.getAmountsOut(factory, amountIn, path);
        // 验证最终输出数量不低于最小可接受值（滑点保护）
        require(
            amounts[amounts.length - 1] >= amountOutMin,
            "UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT"
        );
        // 从调用者地址转移输入代币到第一个交易对
        TransferHelper.safeTransferFrom(
            path[0],
            msg.sender,
            UniswapV2Library.pairFor(factory, path[0], path[1]),
            amounts[0]
        );
        // 执行多路径交换
        _swap(amounts, path, to);
    }

    /**
     * @notice 公开函数：精确输出代币交换输入代币（ERC20-ERC20，支持多路径）
     * @param amountOut 目标输出代币的精确数量
     * @param amountInMax 最大可接受的输入代币数量（滑点保护）
     * @param path 交换路径数组
     * @param to 接收最终输出代币的地址
     * @param deadline 操作截止时间戳
     * @return amounts 各步骤的代币数量数组（amounts[last]为输出，amounts[0]为实际输入）
     * @dev 1. 先计算所需的输入数量；2. 验证输入数量不超过最大值；3. 执行交换
     */
    function swapTokensForExactTokens(
        uint amountOut,
        uint amountInMax,
        address[] calldata path,
        address to,
        uint deadline
    )
        external
        virtual
        override
        ensure(deadline)
        returns (uint[] memory amounts)
    {
        // 计算获取目标输出数量所需的各步骤输入数量
        amounts = UniswapV2Library.getAmountsIn(factory, amountOut, path);
        // 验证实际输入数量不超过最大可接受值（滑点保护）
        require(
            amounts[0] <= amountInMax,
            "UniswapV2Router: EXCESSIVE_INPUT_AMOUNT"
        );
        // 从调用者地址转移输入代币到第一个交易对
        TransferHelper.safeTransferFrom(
            path[0],
            msg.sender,
            UniswapV2Library.pairFor(factory, path[0], path[1]),
            amounts[0]
        );
        // 执行多路径交换
        _swap(amounts, path, to);
    }

    /**
     * @notice 公开函数：精确输入ETH交换代币（ETH-ERC20，支持多路径）
     * @param amountOutMin 最小可接受的最终输出代币数量（滑点保护）
     * @param path 交换路径数组（第一个元素必须为WETH）
     * @param to 接收最终输出代币的地址
     * @param deadline 操作截止时间戳
     * @return amounts 各步骤的代币数量数组
     * @dev 1. 接收调用者发送的ETH，包装为WETH；2. 执行WETH到目标代币的交换；3. 路径必须以WETH开头
     */
    function swapExactETHForTokens(
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    )
        external
        payable
        virtual
        override
        ensure(deadline)
        returns (uint[] memory amounts)
    {
        // 验证交换路径的第一个元素为WETH（ETH需包装为WETH参与交换）
        require(path[0] == WETH, "UniswapV2Router: INVALID_PATH");
        // 计算ETH（WETH）对应的各步骤输出数量
        amounts = UniswapV2Library.getAmountsOut(factory, msg.value, path);
        // 验证最终输出数量不低于最小可接受值
        require(
            amounts[amounts.length - 1] >= amountOutMin,
            "UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT"
        );
        // 将ETH包装为WETH（存入WETH合约）
        IWETH(WETH).deposit{value: amounts[0]}();
        // 转移WETH到第一个交易对（assert确保执行成功）
        assert(
            IWETH(WETH).transfer(
                UniswapV2Library.pairFor(factory, path[0], path[1]),
                amounts[0]
            )
        );
        // 执行多路径交换
        _swap(amounts, path, to);
    }

    /**
     * @notice 公开函数：精确输出ETH交换代币（ERC20-ETH，支持多路径）
     * @param amountOut 目标ETH的精确数量
     * @param amountInMax 最大可接受的输入代币数量（滑点保护）
     * @param path 交换路径数组（最后一个元素必须为WETH）
     * @param to 接收ETH的地址
     * @param deadline 操作截止时间戳
     * @return amounts 各步骤的代币数量数组
     * @dev 1. 输入ERC20代币，交换为WETH后解包为ETH；2. 路径必须以WETH结尾；3. 多余输入代币将退还
     */
    function swapTokensForExactETH(
        uint amountOut,
        uint amountInMax,
        address[] calldata path,
        address to,
        uint deadline
    )
        external
        virtual
        override
        ensure(deadline)
        returns (uint[] memory amounts)
    {
        // 验证交换路径的最后一个元素为WETH（需将WETH解包为ETH）
        require(path[path.length - 1] == WETH, "UniswapV2Router: INVALID_PATH");
        // 计算获取目标ETH数量所需的各步骤输入数量
        amounts = UniswapV2Library.getAmountsIn(factory, amountOut, path);
        // 验证输入数量不超过最大可接受值
        require(
            amounts[0] <= amountInMax,
            "UniswapV2Router: EXCESSIVE_INPUT_AMOUNT"
        );
        // 从调用者地址转移输入代币到第一个交易对
        TransferHelper.safeTransferFrom(
            path[0],
            msg.sender,
            UniswapV2Library.pairFor(factory, path[0], path[1]),
            amounts[0]
        );
        // 执行多路径交换，先将代币转移到当前路由合约
        _swap(amounts, path, address(this));
        // 将WETH解包为ETH
        IWETH(WETH).withdraw(amounts[amounts.length - 1]);
        // 将ETH转移到to地址
        TransferHelper.safeTransferETH(to, amounts[amounts.length - 1]);
    }

    /**
     * @notice 公开函数：精确输入代币交换ETH（ERC20-ETH，支持多路径）
     * @param amountIn 输入ERC20代币的精确数量
     * @param amountOutMin 最小可接受的ETH数量（滑点保护）
     * @param path 交换路径数组（最后一个元素必须为WETH）
     * @param to 接收ETH的地址
     * @param deadline 操作截止时间戳
     * @return amounts 各步骤的代币数量数组
     * @dev 1. 输入ERC20代币，交换为WETH后解包为ETH；2. 路径必须以WETH结尾
     */
    function swapExactTokensForETH(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    )
        external
        virtual
        override
        ensure(deadline)
        returns (uint[] memory amounts)
    {
        // 验证交换路径的最后一个元素为WETH
        require(path[path.length - 1] == WETH, "UniswapV2Router: INVALID_PATH");
        // 计算输入代币对应的各步骤输出数量（最终为WETH数量）
        amounts = UniswapV2Library.getAmountsOut(factory, amountIn, path);
        // 验证最终ETH数量不低于最小可接受值
        require(
            amounts[amounts.length - 1] >= amountOutMin,
            "UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT"
        );
        // 从调用者地址转移输入代币到第一个交易对
        TransferHelper.safeTransferFrom(
            path[0],
            msg.sender,
            UniswapV2Library.pairFor(factory, path[0], path[1]),
            amounts[0]
        );
        // 执行多路径交换，将WETH转移到当前路由合约
        _swap(amounts, path, address(this));
        // 将WETH解包为ETH
        IWETH(WETH).withdraw(amounts[amounts.length - 1]);
        // 将ETH转移到to地址
        TransferHelper.safeTransferETH(to, amounts[amounts.length - 1]);
    }

    /**
     * @notice 公开函数：精确输出代币交换ETH（ETH-ERC20，支持多路径）
     * @param amountOut 目标ERC20代币的精确数量
     * @param path 交换路径数组（第一个元素必须为WETH）
     * @param to 接收代币的地址
     * @param deadline 操作截止时间戳
     * @return amounts 各步骤的代币数量数组
     * @dev 1. 输入ETH，包装为WETH后交换为目标代币；2. 多余ETH将退还；3. 路径必须以WETH开头
     */
    function swapETHForExactTokens(
        uint amountOut,
        address[] calldata path,
        address to,
        uint deadline
    )
        external
        payable
        virtual
        override
        ensure(deadline)
        returns (uint[] memory amounts)
    {
        // 验证交换路径的第一个元素为WETH
        require(path[0] == WETH, "UniswapV2Router: INVALID_PATH");
        // 计算获取目标代币数量所需的ETH（WETH）输入数量
        amounts = UniswapV2Library.getAmountsIn(factory, amountOut, path);
        // 验证输入ETH数量不超过发送的ETH数量
        require(
            amounts[0] <= msg.value,
            "UniswapV2Router: EXCESSIVE_INPUT_AMOUNT"
        );
        // 将所需ETH包装为WETH
        IWETH(WETH).deposit{value: amounts[0]}();
        // 转移WETH到第一个交易对
        assert(
            IWETH(WETH).transfer(
                UniswapV2Library.pairFor(factory, path[0], path[1]),
                amounts[0]
            )
        );
        // 执行多路径交换
        _swap(amounts, path, to);
        // 退还多余的ETH
        if (msg.value > amounts[0])
            TransferHelper.safeTransferETH(msg.sender, msg.value - amounts[0]);
    }

    // ======== 支持fee-on-transfer代币的交换函数 ========

    /**
     * @notice 内部辅助函数：支持fee-on-transfer代币的多路径交换
     * @param path 交换路径数组
     * @param _to 最终接收输出代币的地址
     * @dev 1. 针对转账时扣除手续费的代币设计；2. 实际输入数量以交易对收到的余额为准（扣除手续费后）；3. 动态计算每步输出数量
     */
    function _swapSupportingFeeOnTransferTokens(
        address[] memory path,
        address _to
    ) internal virtual {
        // 遍历交换路径
        for (uint i; i < path.length - 1; i++) {
            // 当前步骤的输入/输出代币
            (address input, address output) = (path[i], path[i + 1]);
            // 排序输入/输出代币，确定token0
            (address token0, ) = UniswapV2Library.sortTokens(input, output);
            // 获取当前交易对合约地址
            IUniswapV2Pair pair = IUniswapV2Pair(
                UniswapV2Library.pairFor(factory, input, output)
            );
            uint amountInput;
            uint amountOutput;
            {
                // 代码块：避免栈溢出（stack too deep）
                // 获取交易对当前储备量
                (uint reserve0, uint reserve1, ) = pair.getReserves();
                // 映射输入/输出代币对应的储备量
                (uint reserveInput, uint reserveOutput) = input == token0
                    ? (reserve0, reserve1)
                    : (reserve1, reserve0);
                // 计算实际输入数量：交易对收到的代币余额 - 原始储备量（扣除手续费后）
                amountInput = IERC20(input).balanceOf(address(pair)).sub(
                    reserveInput
                );
                // 计算当前步骤的输出数量（基于实际输入数量和储备量）
                amountOutput = UniswapV2Library.getAmountOut(
                    amountInput,
                    reserveInput,
                    reserveOutput
                );
            }
            // 确定当前步骤的token0和token1输出数量
            (uint amount0Out, uint amount1Out) = input == token0
                ? (uint(0), amountOutput)
                : (amountOutput, uint(0));
            // 确定当前步骤的接收者
            address to = i < path.length - 2
                ? UniswapV2Library.pairFor(factory, output, path[i + 2])
                : _to;
            // 执行交换
            pair.swap(amount0Out, amount1Out, to, new bytes(0));
        }
    }

    /**
     * @notice 公开函数：支持fee-on-transfer代币的精确输入交换（ERC20-ERC20）
     * @param amountIn 输入代币的精确数量
     * @param amountOutMin 最小可接受的最终输出数量（滑点保护）
     * @param path 交换路径数组
     * @param to 接收最终输出代币的地址
     * @param deadline 操作截止时间戳
     * @dev 1. 输入代币转账时可能扣除手续费，实际输入数量以交易对收到的为准；2. 通过对比转账前后的余额验证输出数量
     */
    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external virtual override ensure(deadline) {
        // 从调用者地址转移输入代币到第一个交易对
        TransferHelper.safeTransferFrom(
            path[0],
            msg.sender,
            UniswapV2Library.pairFor(factory, path[0], path[1]),
            amountIn
        );
        // 记录转账前接收者的目标代币余额
        uint balanceBefore = IERC20(path[path.length - 1]).balanceOf(to);
        // 执行支持fee-on-transfer的多路径交换
        _swapSupportingFeeOnTransferTokens(path, to);
        // 验证最终收到的代币数量（扣除手续费后）不低于最小可接受值
        require(
            IERC20(path[path.length - 1]).balanceOf(to).sub(balanceBefore) >=
                amountOutMin,
            "UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT"
        );
    }

    /**
     * @notice 公开函数：支持fee-on-transfer代币的精确输入ETH交换（ETH-ERC20）
     * @param amountOutMin 最小可接受的最终输出代币数量（滑点保护）
     * @param path 交换路径数组（第一个元素必须为WETH）
     * @param to 接收最终输出代币的地址
     * @param deadline 操作截止时间戳
     * @dev 1. ETH包装为WETH后交换；2. 目标代币支持转账扣手续费；3. 对比余额验证输出数量
     */
    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external payable virtual override ensure(deadline) {
        // 验证路径第一个元素为WETH
        require(path[0] == WETH, "UniswapV2Router: INVALID_PATH");
        // 输入ETH数量为msg.value
        uint amountIn = msg.value;
        // 将ETH包装为WETH
        IWETH(WETH).deposit{value: amountIn}();
        // 转移WETH到第一个交易对
        assert(
            IWETH(WETH).transfer(
                UniswapV2Library.pairFor(factory, path[0], path[1]),
                amountIn
            )
        );
        // 记录接收者目标代币的初始余额
        uint balanceBefore = IERC20(path[path.length - 1]).balanceOf(to);
        // 执行支持fee-on-transfer的交换
        _swapSupportingFeeOnTransferTokens(path, to);
        // 验证最终收到的代币数量不低于最小可接受值
        require(
            IERC20(path[path.length - 1]).balanceOf(to).sub(balanceBefore) >=
                amountOutMin,
            "UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT"
        );
    }

    /**
     * @notice 公开函数：支持fee-on-transfer代币的精确输入交换ETH（ERC20-ETH）
     * @param amountIn 输入ERC20代币的精确数量
     * @param amountOutMin 最小可接受的ETH数量（滑点保护）
     * @param path 交换路径数组（最后一个元素必须为WETH）
     * @param to 接收ETH的地址
     * @param deadline 操作截止时间戳
     * @dev 1. 输入代币支持转账扣手续费；2. 交换为WETH后解包为ETH；3. 验证ETH数量
     */
    function swapExactTokensForETHSupportingFeeOnTransferTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external virtual override ensure(deadline) {
        // 验证路径最后一个元素为WETH
        require(path[path.length - 1] == WETH, "UniswapV2Router: INVALID_PATH");
        // 从调用者地址转移输入代币到第一个交易对
        TransferHelper.safeTransferFrom(
            path[0],
            msg.sender,
            UniswapV2Library.pairFor(factory, path[0], path[1]),
            amountIn
        );
        // 执行支持fee-on-transfer的交换，将WETH转移到当前路由合约
        _swapSupportingFeeOnTransferTokens(path, address(this));
        // 读取路由合约中的WETH余额（实际交换得到的数量）
        uint amountOut = IERC20(WETH).balanceOf(address(this));
        // 验证ETH数量不低于最小可接受值
        require(
            amountOut >= amountOutMin,
            "UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT"
        );
        // 将WETH解包为ETH
        IWETH(WETH).withdraw(amountOut);
        // 转移ETH到to地址
        TransferHelper.safeTransferETH(to, amountOut);
    }

    // ======== 工具库函数（暴露给外部调用） ========

    /**
     * @notice 公开函数：根据储备量计算等价代币数量（报价函数）
     * @param amountA 代币A的数量
     * @param reserveA 代币A的储备量
     * @param reserveB 代币B的储备量
     * @return amountB 与amountA等价的代币B数量（无手续费）
     * @dev 公式：amountB = (amountA * reserveB) / reserveA，纯数学计算，不涉及链上状态
     */
    function quote(
        uint amountA,
        uint reserveA,
        uint reserveB
    ) public pure virtual override returns (uint amountB) {
        return UniswapV2Library.quote(amountA, reserveA, reserveB);
    }

    /**
     * @notice 公开函数：计算输入代币对应的输出数量（含0.3%手续费）
     * @param amountIn 输入代币数量
     * @param reserveIn 输入代币的储备量
     * @param reserveOut 输出代币的储备量
     * @return amountOut 输出代币数量
     * @dev 公式：amountOut = (amountIn * reserveOut * 997) / (reserveIn * 1000 + amountIn * 997)
     */
    function getAmountOut(
        uint amountIn,
        uint reserveIn,
        uint reserveOut
    ) public pure virtual override returns (uint amountOut) {
        return UniswapV2Library.getAmountOut(amountIn, reserveIn, reserveOut);
    }

    /**
     * @notice 公开函数：计算获取目标输出数量所需的输入数量（含0.3%手续费）
     * @param amountOut 目标输出代币数量
     * @param reserveIn 输入代币的储备量
     * @param reserveOut 输出代币的储备量
     * @return amountIn 所需输入代币数量
     * @dev 公式：amountIn = (amountOut * reserveIn * 1000) / ((reserveOut - amountOut) * 997)
     */
    function getAmountIn(
        uint amountOut,
        uint reserveIn,
        uint reserveOut
    ) public pure virtual override returns (uint amountIn) {
        return UniswapV2Library.getAmountIn(amountOut, reserveIn, reserveOut);
    }

    /**
     * @notice 公开函数：计算多路径交换的输出数量数组（含0.3%手续费）
     * @param amountIn 初始输入代币数量
     * @param path 交换路径数组
     * @return amounts 各步骤的代币数量数组（amounts[0]为输入，后续为各步输出）
     * @dev 遍历路径，依次调用getAmountOut计算每步输出
     */
    function getAmountsOut(
        uint amountIn,
        address[] memory path
    ) public view virtual override returns (uint[] memory amounts) {
        return UniswapV2Library.getAmountsOut(factory, amountIn, path);
    }

    /**
     * @notice 公开函数：计算多路径交换的输入数量数组（含0.3%手续费）
     * @param amountOut 最终目标输出代币数量
     * @param path 交换路径数组
     * @return amounts 各步骤的代币数量数组（amounts[last]为输出，amounts[0]为初始输入）
     * @dev 逆向遍历路径，依次调用getAmountIn计算每步输入
     */
    function getAmountsIn(
        uint amountOut,
        address[] memory path
    ) public view virtual override returns (uint[] memory amounts) {
        return UniswapV2Library.getAmountsIn(factory, amountOut, path);
    }
}
