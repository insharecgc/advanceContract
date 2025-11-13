### Uniswap V2 核心合约与外围路由接口文档
### 目录
[1. Uniswap V2 Core 接口文档](https://github.com/Uniswap/v2-core)
[    - 1.1 UniswapV2Factory 合约](https://github.com/Uniswap/v2-core/blob/master/contracts/UniswapV2Factory.sol)
[    - 1.2 UniswapV2Pair 合约](https://github.com/Uniswap/v2-core/blob/master/contracts/UniswapV2Pair.sol)
[2. Uniswap V2 Periphery 接口文档](https://github.com/Uniswap/v2-periphery)
[    - 2.1 UniswapV2Router02 合约](https://github.com/Uniswap/v2-periphery/blob/master/contracts/UniswapV2Router02.sol)

### 1. Uniswap V2 Core 接口文档
核心合约包含 UniswapV2Factory（交易对工厂）和 UniswapV2Pair（交易对实例），是 Uniswap V2 协议的底层核心，实现了交易对创建、流动性管理和代币交换的核心逻辑。
## 1.1 UniswapV2Factory 合约
# 1.1.1 状态变量
| 变量名           | 类型                                       | 含义                                                         |
| ---------------- | ------------------------------------------ | ------------------------------------------------------------ |
| `feeTo`          | `address`                                  | 协议费用接收地址（默认为零地址，可通过 `setFeeTo` 方法修改）|
| `feeToSetter`    | `address`                                  | 有权设置 `feeTo` 的地址（部署时指定，可通过 `setFeeToSetter` 方法修改） |
| `allPairs`       | `address[]`                                | 所有创建的交易对地址列表（按创建顺序存储）|
| `allPairsLength` | `uint256`                                  | 已创建的交易对总数                                           |
| `getPair`        | `mapping(address => mapping(address => address))` | 双代币地址到交易对地址的映射（不区分代币顺序，自动按字典序匹配） |

# 1.1.2 核心函数
`function createPair(address tokenA, address tokenB) external returns (address pair)`

- **功能描述**：创建两个代币之间的交易对合约（若该交易对尚未存在）。
- **处理逻辑**：
  1. 校验参数有效性：`tokenA` 和 `tokenB` 不能为零地址，且不能相同；
  2. 代币排序：按地址字典序对 `tokenA` 和 `tokenB` 排序（确保 `token0 < token1`），避免重复创建交易对；
  3. 检查交易对是否已存在：通过 `getPair` 映射查询，若已存在则回滚并抛出异常；
  4. 部署交易对合约：使用 `CREATE2` opcode 部署 `UniswapV2Pair` 合约，确保交易对地址可预计算；
  5. 初始化交易对：调用新部署交易对的 `initialize` 方法，传入排序后的 `token0` 和 `token1`；
  6. 状态更新：将交易对地址存入 `getPair` 映射和 `allPairs` 列表，递增 `allPairsLength`；
  7. 事件触发：发射 `PairCreated` 事件，通知前端交易对创建完成。
- **参数说明**：
  - `tokenA`：第一个代币地址（无需关心顺序，合约会自动排序）；
  - `tokenB`：第二个代币地址（无需关心顺序，合约会自动排序）。
- **返回值**：新创建的交易对合约地址。
- **异常情况**：
  - 若 `tokenA == tokenB`，抛出 `UniswapV2: IDENTICAL_ADDRESSES`；
  - 若 `tokenA` 或 `tokenB` 为零地址，抛出 `UniswapV2: ZERO_ADDRESS`；
  - 若交易对已存在，抛出 `UniswapV2: PAIR_EXISTS`。

`function setFeeTo(address _feeTo) external`

- **功能描述**：更新协议费用的接收地址（仅 feeToSetter 可调用）。
- **处理逻辑**：
  1. 权限校验：检查调用者是否为当前 feeToSetter，否则回滚；
  2. 状态更新：将 feeTo 变量更新为 _feeTo。
- **参数说明**：_feeTo：新的协议费用接收地址（可为零地址，即关闭协议费用）。
- **异常情况**：非 feeToSetter 调用时，抛出 UniswapV2: FORBIDDEN。

`function setFeeToSetter(address _feeToSetter) external`
- **功能描述**：转移 feeTo 的设置权限（仅当前 feeToSetter 可调用）。
- **处理逻辑**：
  1. 权限校验：检查调用者是否为当前 feeToSetter，否则回滚；
  2. 状态更新：将 feeToSetter 变量更新为 _feeToSetter。
- **参数说明**：_feeToSetter：新的权限持有者地址（需为有效地址）。
- **异常情况**：非当前 feeToSetter 调用时，抛出 UniswapV2: FORBIDDEN。

## 1.2 UniswapV2Pair 合约
# 1.2.1 状态变量
| 变量名           | 类型      | 含义                                                         |
| ---------------- | --------- | ------------------------------------------------------------ |
| `factory`        | `address` | 部署该交易对的 UniswapV2Factory 合约地址（不可修改）|
| `token0`         | `address` | 交易对中排序靠前的代币地址（字典序较小，不可修改）|
| `token1`         | `address` | 交易对中排序靠后的代币地址（字典序较大，不可修改）|
| `reserve0`       | `uint112` | 代币 0 在交易对中的储备量（仅通过 `_update` 方法更新）|
| `reserve1`       | `uint112` | 代币 1 在交易对中的储备量（仅通过 `_update` 方法更新）|
| `blockTimestampLast` | `uint32`  | 最后一次更新储备量的区块时间戳（用于计算时间加权平均价格）|
| `price0CumulativeLast` | `uint256` | 代币 0 的价格累积值（`reserve1 / reserve0` 乘以时间差的累积，用于 TWAP） |
| `price1CumulativeLast` | `uint256` | 代币 1 的价格累积值（`reserve0 / reserve1` 乘以时间差的累积，用于 TWAP） |
| `kLast`          | `uint256` | 最后一次 √ 量乘积（`reserve0 * reserve1`，用于协议费用计算）|

# 1.2.2 核心函数
`function _mintFee(uint112 _reserve0, uint112 _reserve1) private returns (bool feeOn)`
 - **功能描述**：向交易对添加流动性，发行 LP 代币（流动性凭证）给指定地址。
 - **处理逻辑**：
  1. 计算待添加的流动性：通过 balanceOf 方法获取交易对当前持有的 token0 和 token1 余额，与 reserve0/reserve1 的差值即为待添加的 amount0 和 amount1；
  2. 校验流动性：若 amount0 或 amount1 为零，回滚并抛出异常；
  3. 计算 LP 代币数量：
    - 首次添加流动性（totalSupply == 0）：liquidity = sqrt(amount0 * amount1) - MINIMUM_LIQUIDITY（MINIMUM_LIQUIDITY 为 1000，永久锁定在零地址，防止 LP 代币价格波动过大）；
    - 非首次添加：liquidity = min(amount0 * totalSupply / reserve0, amount1 * totalSupply / reserve1)（按当前储备比例计算，取较小值避免比例失衡）；
  4. 校验 LP 数量：若计算出的 liquidity 为零，回滚并抛出异常；
  5. 发行 LP 代币：调用 _mint 方法向 to 地址发行 liquidity 数量的 LP 代币；
  6. 更新储备：调用 _update 方法更新 reserve0、reserve1 和 blockTimestampLast；
  7. 协议费用处理：若 feeTo 非零地址，更新 kLast 为当前储备乘积；
  8. 事件触发：发射 Mint 和 Sync 事件。
 - **参数说明**：to：接收 LP 代币的地址（需为有效地址）。
 - **返回值**：实际发行的 LP 代币数量（扣除永久锁定的 MINIMUM_LIQUIDITY）。
 - **异常情况**：
  - 若 amount0 或 amount1 为零，抛出 UniswapV2: INSUFFICIENT_LIQUIDITY_MINTED；
  - 若计算出的 liquidity 为零，抛出 UniswapV2: INSUFFICIENT_LIQUIDITY_MINTED。

`function burn(address to) external lock returns (uint amount0, uint amount1)`
 - **功能描述**：销毁 LP 代币，从交易对中提取对应比例的 token0 和 token1 到指定地址。
- **处理逻辑**：
  1. 获取 LP 代币余额：调用 balanceOf[address(this)] 获取交易对持有的 LP 代币数量（即要销毁的数量）；
  2. 计算提取金额：amount0 = balance * reserve0 / totalSupply，amount1 = balance * reserve1 / totalSupply（按 LP 代币占比提取）；
  3. 校验提取金额：若 amount0 或 amount1 为零，回滚并抛出异常；
  4. 销毁 LP 代币：调用 _burn 方法销毁交易对持有的 LP 代币；
  5. 转移代币：调用 safeTransfer 方法将 amount0 和 amount1 转移到 to 地址；
  6. 更新储备：调用 _update 方法更新 reserve0、reserve1 和 blockTimestampLast；
  7. 协议费用处理：若 feeTo 非零地址，更新 kLast 为当前储备乘积；
  8. 事件触发：发射 Burn 和 Sync 事件。
- **参数说明**：to：接收 token0 和 token1 的地址（需为有效地址）。
- **返回值**：实际提取的 token0 数量（amount0）和 token1 数量（amount1）。
- **异常情况**：
  - 若 amount0 或 amount1 为零，抛出 UniswapV2: INSUFFICIENT_LIQUIDITY_BURNED；
  - 若代币转移失败（如 to 地址不支持 ERC20 接收），抛出 TransferFailed。

`function swap(uint amount0Out, uint amount1Out, address to, bytes calldata data) external lock`
- **功能描述**：通过交易对进行代币交换，提取指定数量的 token0 或 token1，并向交易对存入对应数量的另一种代币（遵循恒定乘积公式）。
- **处理逻辑**：
  1. 校验输出金额：amount0Out 和 amount1Out 不能同时为零，且不能超过当前储备量；
  2. 校验接收地址：to 不能为零地址，且不能是交易对合约本身（避免重入）；
  3. 提取代币：调用 safeTransfer 方法将 amount0Out 和 amount1Out 转移到 to 地址；
  4. 计算输入金额：通过 balanceOf 方法获取交易对当前持有的 token0 和 token1 余额，与更新后的储备量（reserve0 - amount0Out/reserve1 - amount1Out）的差值即为 amount0In 和 amount1In；
  5. 校验恒定乘积：确保 (reserve0 - amount0Out + amount0In) * (reserve1 - amount1Out + amount1In) >= reserve0 * reserve1（满足 k 不变原则，扣除 0.3% 手续费后）；
  6. 更新储备：调用 _update 方法更新 reserve0、reserve1 和 blockTimestampLast；
  7. 回调处理：若 data 非空，调用 to 地址的 uniswapV2Call 方法（支持外部合约回调）；
  8. 事件触发：发射 Swap 和 Sync 事件。
- **参数说明**：
  - amount0Out：要提取的 token0 数量（可为 0，但不能与 amount1Out 同时为 0）；
  - amount1Out：要提取的 token1 数量（可为 0，但不能与 amount0Out 同时为 0）；
  - to：接收提取代币的地址（需为有效地址，且非交易对合约本身）；
  - data：附加数据（可选，用于触发 to 地址的回调函数）。
- **异常情况**：
  - 若 amount0Out 和 amount1Out 同时为零，抛出 UniswapV2: INSUFFICIENT_OUTPUT_AMOUNT；
  - 若 amount0Out > reserve0 或 amount1Out > reserve1，抛出 UniswapV2: INSUFFICIENT_LIQUIDITY；
  - 若 to 为零地址或交易对合约地址，抛出 UniswapV2: INVALID_TO；
  - 若交换后破坏恒定乘积公式，抛出 UniswapV2: K；
  - 若代币转移失败，抛出 TransferFailed。

`function getReserves() public view returns (uint112 _reserve0, uint112 _reserve1, uint32 _blockTimestampLast)`
 - **功能描述**：查询交易对当前的储备量和最后一次更新时间戳（用于前端计算价格、流动性等）。
 - **返回值**：
  - _reserve0：当前 token0 的储备量；
  - _reserve1：当前 token1 的储备量；
  - _blockTimestampLast：最后一次更新储备量的区块时间戳。

`function sync() external lock`
 - **功能描述**：手动同步交易对的储备量（将交易对当前持有的代币余额更新为 reserve0 和 reserve1）。
 - **处理逻辑**：
  1. 读取当前余额：调用 balanceOf 方法获取交易对持有的 token0 和 token1 余额；
  1. 更新储备：调用 _update 方法将 reserve0 和 reserve1 更新为当前余额，同时更新 blockTimestampLast；
  1. 事件触发：发射 Sync 事件。
 - **适用场景**：当外部账户直接向交易对合约转账代币时，储备量未自动更新，需调用此方法同步。
