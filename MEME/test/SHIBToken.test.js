const hre = require("hardhat");
const { expect, config } = require("chai");
const { ethers } = hre;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

describe("SHIBT (SHIM) Token", function () {
    this.timeout(600 * 1000); // 设置超时为10分钟

    let SHIBToken, memeToken;
    let owner, treasury, user1, user2;
    let weth, router, factory, pairAddress, memeTokenAddress;
    let tx;

    let routerAddress = "0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008"; // sepolia网上的router地址
    let wethAddress = "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9"  // Sepolia上的WETH地址

    // 部署参数配置
    let tokenConfig = {
        name: "SHIB Style Meme",
        symbol: "SHIM",
        minLockLp: 30,  // 初始化：最小锁仓时间30秒（方便测试）
        adminDelay: 10, // 初始化：管理员修改税率延迟时间10秒（方便测试）

        // 测试参数
        buyTaxBps: 500, // 5% 买入税率
        sellTaxBps: 1200, // 12% 卖出税率
        minDelayBetweenTx: 10, // 10秒内禁止交易，最小10
    };

    beforeEach(async function () {
        [owner, treasury, user1, user2] = await ethers.getSigners();
        console.log("Deploying contracts with the account:", owner.address);
        console.log("treasury, user1", treasury.address, user1.address, user2.address);

        // console.log("\n⏳ 正在部署合约...");
        // console.log("代币名称:", tokenConfig.name);
        // console.log("代币符号:", tokenConfig.symbol);
        // console.log("国库地址:", treasury.address);

        // // 部署合约
        // SHIBToken = await ethers.getContractFactory("SHIBToken");
        // memeToken = await SHIBToken.deploy(
        //     tokenConfig.name,
        //     tokenConfig.symbol,
        //     treasury.address,
        //     routerAddress,
        //     tokenConfig.minLockLp,
        //     tokenConfig.adminDelay
        // );
        // await memeToken.waitForDeployment();
        // console.log("✅ 合约部署成功!");
        // memeTokenAddress = memeToken.target
        // console.log("📄 合约地址:", memeTokenAddress);  // 0x11eD09B441dFB9dcd2D18E87D67339F2752FbD2D，0x45dFd0efbAB2a4DE716A4393464c3Ce4DBa6d984

        /** -------------------------已经发布到Sepolia网了，这里不再重新发布，直接取合约地址------------------------- */
        // 获取meme币合约实例
        memeTokenAddress = "0x11eD09B441dFB9dcd2D18E87D67339F2752FbD2D";
        SHIBToken = await ethers.getContractFactory("SHIBToken");
        memeToken = SHIBToken.attach(memeTokenAddress);
        console.log("📄 合约地址:", memeTokenAddress);

        // 获取WETH合约实例
        const WETHABI = [{ "constant": true, "inputs": [], "name": "name", "outputs": [{ "name": "", "type": "string" }], "payable": false, "stateMutability": "view", "type": "function" }, { "constant": false, "inputs": [{ "name": "guy", "type": "address" }, { "name": "wad", "type": "uint256" }], "name": "approve", "outputs": [{ "name": "", "type": "bool" }], "payable": false, "stateMutability": "nonpayable", "type": "function" }, { "constant": true, "inputs": [], "name": "totalSupply", "outputs": [{ "name": "", "type": "uint256" }], "payable": false, "stateMutability": "view", "type": "function" }, { "constant": false, "inputs": [{ "name": "src", "type": "address" }, { "name": "dst", "type": "address" }, { "name": "wad", "type": "uint256" }], "name": "transferFrom", "outputs": [{ "name": "", "type": "bool" }], "payable": false, "stateMutability": "nonpayable", "type": "function" }, { "constant": false, "inputs": [{ "name": "wad", "type": "uint256" }], "name": "withdraw", "outputs": [], "payable": false, "stateMutability": "nonpayable", "type": "function" }, { "constant": true, "inputs": [], "name": "decimals", "outputs": [{ "name": "", "type": "uint8" }], "payable": false, "stateMutability": "view", "type": "function" }, { "constant": true, "inputs": [{ "name": "", "type": "address" }], "name": "balanceOf", "outputs": [{ "name": "", "type": "uint256" }], "payable": false, "stateMutability": "view", "type": "function" }, { "constant": true, "inputs": [], "name": "symbol", "outputs": [{ "name": "", "type": "string" }], "payable": false, "stateMutability": "view", "type": "function" }, { "constant": false, "inputs": [{ "name": "dst", "type": "address" }, { "name": "wad", "type": "uint256" }], "name": "transfer", "outputs": [{ "name": "", "type": "bool" }], "payable": false, "stateMutability": "nonpayable", "type": "function" }, { "constant": false, "inputs": [], "name": "deposit", "outputs": [], "payable": true, "stateMutability": "payable", "type": "function" }, { "constant": true, "inputs": [{ "name": "", "type": "address" }, { "name": "", "type": "address" }], "name": "allowance", "outputs": [{ "name": "", "type": "uint256" }], "payable": false, "stateMutability": "view", "type": "function" }, { "payable": true, "stateMutability": "payable", "type": "fallback" }, { "anonymous": false, "inputs": [{ "indexed": true, "name": "src", "type": "address" }, { "indexed": true, "name": "guy", "type": "address" }, { "indexed": false, "name": "wad", "type": "uint256" }], "name": "Approval", "type": "event" }, { "anonymous": false, "inputs": [{ "indexed": true, "name": "src", "type": "address" }, { "indexed": true, "name": "dst", "type": "address" }, { "indexed": false, "name": "wad", "type": "uint256" }], "name": "Transfer", "type": "event" }, { "anonymous": false, "inputs": [{ "indexed": true, "name": "dst", "type": "address" }, { "indexed": false, "name": "wad", "type": "uint256" }], "name": "Deposit", "type": "event" }, { "anonymous": false, "inputs": [{ "indexed": true, "name": "src", "type": "address" }, { "indexed": false, "name": "wad", "type": "uint256" }], "name": "Withdrawal", "type": "event" }];
        const provider = ethers.provider;
        weth = new ethers.Contract(wethAddress, WETHABI, provider);
        console.log("📄 WETH 地址:", weth.target);

        // 获取UniswapV2Router02实例
        const routerABI = [{ "inputs": [{ "internalType": "address", "name": "_factory", "type": "address" }, { "internalType": "address", "name": "_WETH", "type": "address" }], "stateMutability": "nonpayable", "type": "constructor" }, { "inputs": [], "name": "WETH", "outputs": [{ "internalType": "address", "name": "", "type": "address" }], "stateMutability": "view", "type": "function" }, { "inputs": [{ "internalType": "address", "name": "tokenA", "type": "address" }, { "internalType": "address", "name": "tokenB", "type": "address" }, { "internalType": "uint256", "name": "amountADesired", "type": "uint256" }, { "internalType": "uint256", "name": "amountBDesired", "type": "uint256" }, { "internalType": "uint256", "name": "amountAMin", "type": "uint256" }, { "internalType": "uint256", "name": "amountBMin", "type": "uint256" }, { "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "deadline", "type": "uint256" }], "name": "addLiquidity", "outputs": [{ "internalType": "uint256", "name": "amountA", "type": "uint256" }, { "internalType": "uint256", "name": "amountB", "type": "uint256" }, { "internalType": "uint256", "name": "liquidity", "type": "uint256" }], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [{ "internalType": "address", "name": "token", "type": "address" }, { "internalType": "uint256", "name": "amountTokenDesired", "type": "uint256" }, { "internalType": "uint256", "name": "amountTokenMin", "type": "uint256" }, { "internalType": "uint256", "name": "amountETHMin", "type": "uint256" }, { "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "deadline", "type": "uint256" }], "name": "addLiquidityETH", "outputs": [{ "internalType": "uint256", "name": "amountToken", "type": "uint256" }, { "internalType": "uint256", "name": "amountETH", "type": "uint256" }, { "internalType": "uint256", "name": "liquidity", "type": "uint256" }], "stateMutability": "payable", "type": "function" }, { "inputs": [], "name": "factory", "outputs": [{ "internalType": "address", "name": "", "type": "address" }], "stateMutability": "view", "type": "function" }, { "inputs": [{ "internalType": "uint256", "name": "amountOut", "type": "uint256" }, { "internalType": "uint256", "name": "reserveIn", "type": "uint256" }, { "internalType": "uint256", "name": "reserveOut", "type": "uint256" }], "name": "getAmountIn", "outputs": [{ "internalType": "uint256", "name": "amountIn", "type": "uint256" }], "stateMutability": "pure", "type": "function" }, { "inputs": [{ "internalType": "uint256", "name": "amountIn", "type": "uint256" }, { "internalType": "uint256", "name": "reserveIn", "type": "uint256" }, { "internalType": "uint256", "name": "reserveOut", "type": "uint256" }], "name": "getAmountOut", "outputs": [{ "internalType": "uint256", "name": "amountOut", "type": "uint256" }], "stateMutability": "pure", "type": "function" }, { "inputs": [{ "internalType": "uint256", "name": "amountOut", "type": "uint256" }, { "internalType": "address[]", "name": "path", "type": "address[]" }], "name": "getAmountsIn", "outputs": [{ "internalType": "uint256[]", "name": "amounts", "type": "uint256[]" }], "stateMutability": "view", "type": "function" }, { "inputs": [{ "internalType": "uint256", "name": "amountIn", "type": "uint256" }, { "internalType": "address[]", "name": "path", "type": "address[]" }], "name": "getAmountsOut", "outputs": [{ "internalType": "uint256[]", "name": "amounts", "type": "uint256[]" }], "stateMutability": "view", "type": "function" }, { "inputs": [{ "internalType": "uint256", "name": "amountA", "type": "uint256" }, { "internalType": "uint256", "name": "reserveA", "type": "uint256" }, { "internalType": "uint256", "name": "reserveB", "type": "uint256" }], "name": "quote", "outputs": [{ "internalType": "uint256", "name": "amountB", "type": "uint256" }], "stateMutability": "pure", "type": "function" }, { "inputs": [{ "internalType": "address", "name": "tokenA", "type": "address" }, { "internalType": "address", "name": "tokenB", "type": "address" }, { "internalType": "uint256", "name": "liquidity", "type": "uint256" }, { "internalType": "uint256", "name": "amountAMin", "type": "uint256" }, { "internalType": "uint256", "name": "amountBMin", "type": "uint256" }, { "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "deadline", "type": "uint256" }], "name": "removeLiquidity", "outputs": [{ "internalType": "uint256", "name": "amountA", "type": "uint256" }, { "internalType": "uint256", "name": "amountB", "type": "uint256" }], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [{ "internalType": "address", "name": "token", "type": "address" }, { "internalType": "uint256", "name": "liquidity", "type": "uint256" }, { "internalType": "uint256", "name": "amountTokenMin", "type": "uint256" }, { "internalType": "uint256", "name": "amountETHMin", "type": "uint256" }, { "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "deadline", "type": "uint256" }], "name": "removeLiquidityETH", "outputs": [{ "internalType": "uint256", "name": "amountToken", "type": "uint256" }, { "internalType": "uint256", "name": "amountETH", "type": "uint256" }], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [{ "internalType": "address", "name": "token", "type": "address" }, { "internalType": "uint256", "name": "liquidity", "type": "uint256" }, { "internalType": "uint256", "name": "amountTokenMin", "type": "uint256" }, { "internalType": "uint256", "name": "amountETHMin", "type": "uint256" }, { "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "deadline", "type": "uint256" }], "name": "removeLiquidityETHSupportingFeeOnTransferTokens", "outputs": [{ "internalType": "uint256", "name": "amountETH", "type": "uint256" }], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [{ "internalType": "address", "name": "token", "type": "address" }, { "internalType": "uint256", "name": "liquidity", "type": "uint256" }, { "internalType": "uint256", "name": "amountTokenMin", "type": "uint256" }, { "internalType": "uint256", "name": "amountETHMin", "type": "uint256" }, { "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "deadline", "type": "uint256" }, { "internalType": "bool", "name": "approveMax", "type": "bool" }, { "internalType": "uint8", "name": "v", "type": "uint8" }, { "internalType": "bytes32", "name": "r", "type": "bytes32" }, { "internalType": "bytes32", "name": "s", "type": "bytes32" }], "name": "removeLiquidityETHWithPermit", "outputs": [{ "internalType": "uint256", "name": "amountToken", "type": "uint256" }, { "internalType": "uint256", "name": "amountETH", "type": "uint256" }], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [{ "internalType": "address", "name": "token", "type": "address" }, { "internalType": "uint256", "name": "liquidity", "type": "uint256" }, { "internalType": "uint256", "name": "amountTokenMin", "type": "uint256" }, { "internalType": "uint256", "name": "amountETHMin", "type": "uint256" }, { "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "deadline", "type": "uint256" }, { "internalType": "bool", "name": "approveMax", "type": "bool" }, { "internalType": "uint8", "name": "v", "type": "uint8" }, { "internalType": "bytes32", "name": "r", "type": "bytes32" }, { "internalType": "bytes32", "name": "s", "type": "bytes32" }], "name": "removeLiquidityETHWithPermitSupportingFeeOnTransferTokens", "outputs": [{ "internalType": "uint256", "name": "amountETH", "type": "uint256" }], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [{ "internalType": "address", "name": "tokenA", "type": "address" }, { "internalType": "address", "name": "tokenB", "type": "address" }, { "internalType": "uint256", "name": "liquidity", "type": "uint256" }, { "internalType": "uint256", "name": "amountAMin", "type": "uint256" }, { "internalType": "uint256", "name": "amountBMin", "type": "uint256" }, { "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "deadline", "type": "uint256" }, { "internalType": "bool", "name": "approveMax", "type": "bool" }, { "internalType": "uint8", "name": "v", "type": "uint8" }, { "internalType": "bytes32", "name": "r", "type": "bytes32" }, { "internalType": "bytes32", "name": "s", "type": "bytes32" }], "name": "removeLiquidityWithPermit", "outputs": [{ "internalType": "uint256", "name": "amountA", "type": "uint256" }, { "internalType": "uint256", "name": "amountB", "type": "uint256" }], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [{ "internalType": "uint256", "name": "amountOut", "type": "uint256" }, { "internalType": "address[]", "name": "path", "type": "address[]" }, { "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "deadline", "type": "uint256" }], "name": "swapETHForExactTokens", "outputs": [{ "internalType": "uint256[]", "name": "amounts", "type": "uint256[]" }], "stateMutability": "payable", "type": "function" }, { "inputs": [{ "internalType": "uint256", "name": "amountOutMin", "type": "uint256" }, { "internalType": "address[]", "name": "path", "type": "address[]" }, { "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "deadline", "type": "uint256" }], "name": "swapExactETHForTokens", "outputs": [{ "internalType": "uint256[]", "name": "amounts", "type": "uint256[]" }], "stateMutability": "payable", "type": "function" }, { "inputs": [{ "internalType": "uint256", "name": "amountOutMin", "type": "uint256" }, { "internalType": "address[]", "name": "path", "type": "address[]" }, { "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "deadline", "type": "uint256" }], "name": "swapExactETHForTokensSupportingFeeOnTransferTokens", "outputs": [], "stateMutability": "payable", "type": "function" }, { "inputs": [{ "internalType": "uint256", "name": "amountIn", "type": "uint256" }, { "internalType": "uint256", "name": "amountOutMin", "type": "uint256" }, { "internalType": "address[]", "name": "path", "type": "address[]" }, { "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "deadline", "type": "uint256" }], "name": "swapExactTokensForETH", "outputs": [{ "internalType": "uint256[]", "name": "amounts", "type": "uint256[]" }], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [{ "internalType": "uint256", "name": "amountIn", "type": "uint256" }, { "internalType": "uint256", "name": "amountOutMin", "type": "uint256" }, { "internalType": "address[]", "name": "path", "type": "address[]" }, { "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "deadline", "type": "uint256" }], "name": "swapExactTokensForETHSupportingFeeOnTransferTokens", "outputs": [], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [{ "internalType": "uint256", "name": "amountIn", "type": "uint256" }, { "internalType": "uint256", "name": "amountOutMin", "type": "uint256" }, { "internalType": "address[]", "name": "path", "type": "address[]" }, { "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "deadline", "type": "uint256" }], "name": "swapExactTokensForTokens", "outputs": [{ "internalType": "uint256[]", "name": "amounts", "type": "uint256[]" }], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [{ "internalType": "uint256", "name": "amountIn", "type": "uint256" }, { "internalType": "uint256", "name": "amountOutMin", "type": "uint256" }, { "internalType": "address[]", "name": "path", "type": "address[]" }, { "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "deadline", "type": "uint256" }], "name": "swapExactTokensForTokensSupportingFeeOnTransferTokens", "outputs": [], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [{ "internalType": "uint256", "name": "amountOut", "type": "uint256" }, { "internalType": "uint256", "name": "amountInMax", "type": "uint256" }, { "internalType": "address[]", "name": "path", "type": "address[]" }, { "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "deadline", "type": "uint256" }], "name": "swapTokensForExactETH", "outputs": [{ "internalType": "uint256[]", "name": "amounts", "type": "uint256[]" }], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [{ "internalType": "uint256", "name": "amountOut", "type": "uint256" }, { "internalType": "uint256", "name": "amountInMax", "type": "uint256" }, { "internalType": "address[]", "name": "path", "type": "address[]" }, { "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "deadline", "type": "uint256" }], "name": "swapTokensForExactTokens", "outputs": [{ "internalType": "uint256[]", "name": "amounts", "type": "uint256[]" }], "stateMutability": "nonpayable", "type": "function" }, { "stateMutability": "payable", "type": "receive" }];
        router = new ethers.Contract(routerAddress, routerABI, provider);
        console.log("📄 router 地址:", router.target);
        /** ---------------------------------------------------------------------------------------------------- */
        pairAddress = await memeToken.getUniswapPair();
        console.log("📄 Uniswap Pair 地址:", pairAddress);
    });

    // 已通过测试
    it("修改配置验证", async function () {
        // 验证名单
        expect(await memeToken.isWhitelisted(routerAddress)).to.be.true;
        expect(await memeToken.isWhitelisted(pairAddress)).to.be.true;
        expect(await memeToken.isWhitelisted(memeTokenAddress)).to.be.true;
        const ownerAddress = await owner.getAddress();
        expect(await memeToken.isWhitelisted(ownerAddress)).to.be.true;

        // 验证免税地址
        expect(await memeToken.isTaxExempt(treasury.address)).to.be.true;
        expect(await memeToken.isTaxExempt(memeTokenAddress)).to.be.true;
        expect(await memeToken.isTaxExempt(ownerAddress)).to.be.true;

        // 提案修改税率
        console.log("\n⚙️ 提案修改税率...");
        let tx = await memeToken.proposeSetTaxBps(
            tokenConfig.buyTaxBps,
            tokenConfig.sellTaxBps,
            { gasLimit: 300000 } // 手动设置gas限制（根据实际消耗调整）
        );
        const receipt = await tx.wait();
        const provider = ethers.provider;
        const block = await provider.getBlock(receipt.blockNumber)
        console.log("交易区块时间：", block.timestamp.toString());
        let [buyTaxBps, sellTaxBps] = await memeToken.getTax()
        console.log("提案修改税率后，buyTaxBps:", buyTaxBps.toString(), "sellTaxBps:", sellTaxBps.toString());
        // 默认应该是500和1000
        expect(buyTaxBps.toString()).to.eq("500")
        expect(sellTaxBps.toString()).to.eq("1000")

        console.log("\n⏳ 延迟10秒,执行修改税率...");
        await sleep(10000);
        tx = await memeToken.executeSetTaxBps(
            tokenConfig.buyTaxBps,
            tokenConfig.sellTaxBps,
            block.timestamp
        );
        await tx.wait();
        console.log("✅ 执行提案修改税率完成");

        // 验证配置
        console.log("\n🔍 查询合约配置...");
        [buyTaxBps, sellTaxBps] = await memeToken.getTax()
        console.log("修改税率后，buyTaxBps:", buyTaxBps.toString(), "sellTaxBps:", sellTaxBps.toString());
        // 修改生效，税率应该是修改值
        expect(buyTaxBps.toString()).to.eq(tokenConfig.buyTaxBps.toString())
        expect(sellTaxBps.toString()).to.eq(tokenConfig.sellTaxBps.toString())

        console.log("\n⚙️ 修改交易间隔时间...");
        tx = await memeToken.setMinTxDelay(tokenConfig.minDelayBetweenTx)
        await tx.wait()
        const mindelayBetweenTx = await memeToken.getMinDelayBetweenTx()
        console.log("修改易间隔时间后，minDelayBetweenTx:", mindelayBetweenTx);
        // 修改生效，交易间隔应该是修改值
        expect(mindelayBetweenTx).to.eq(tokenConfig.minDelayBetweenTx)
    });


    // 已通过测试
    it("初始化流动验证", async function () {
        // 初始添加流动性
        console.log("\n⚙️ 初始添加流动性...");
        // 获取交易前的 pair 余额
        const pairBalanceBefore = await memeToken.balanceOf(pairAddress);
        expect(pairBalanceBefore).to.equal(0, "Pair should have no tokens before liquidity added");
        const initialLiquidityMeme = ethers.parseEther("100000000000");   // 100亿SHIM == 0.001ETH
        const initialLiquidityEth = ethers.parseEther("0.001");
        // Owner 发送 ETH 给合约
        tx = await owner.sendTransaction({ to: memeTokenAddress, value: initialLiquidityEth });
        await tx.wait(3);
        const memTokenEth = await ethers.provider.getBalance(memeTokenAddress)
        console.log("📄 合约余额:", memTokenEth.toString());
        expect(memTokenEth).to.equal(initialLiquidityEth);
        // Owner 授权 Router 使用代币
        console.log("\n⚙️ 授权 Router 使用代币...");
        tx = await memeToken.approve(routerAddress, initialLiquidityMeme);
        await tx.wait(3);
        //调用合约的 addInitialLiquidity 函数，初始化流动性池
        console.log("\n⚙️ 添加流动性池...");
        tx = await memeToken.addInitialLiquidity(initialLiquidityMeme, initialLiquidityEth)
        await tx.wait(3);

        // 验证交易对余额
        const pairBalance = await memeToken.balanceOf(pairAddress);
        const wethInPair = await weth.balanceOf(pairAddress);
        console.log("pairMemeBalance:", pairBalance.toString(), "wethInPair:", wethInPair.toString());
        expect(pairBalance).to.equal(initialLiquidityMeme); // 100亿SHIM
        expect(wethInPair).to.equal(initialLiquidityEth);   // 0.001ETH
    });

    // 已通过测试
    it("验证转账功能", async function () {
        console.log("免税地址转账给user1...")
        const user1BalanceBefore = await memeToken.balanceOf(user1.address);
        let transAmount = ethers.parseEther("10000000000");   // 10亿SHIM
        tx = await memeToken.transfer(user1.address, transAmount);
        await tx.wait(3);
        const ownerBalance = await memeToken.balanceOf(owner.address);
        console.log("owner banlance:", ethers.formatEther(ownerBalance));
        const user1BalanceAfter = await memeToken.balanceOf(user1.address);
        const user1Receive = user1BalanceAfter - user1BalanceBefore;
        console.log("✅由免税地址转账，不收手续费，收到:", ethers.formatEther(user1Receive));
        expect(user1Receive).to.equal(transAmount);

        console.log("非免税地址user1转账给user2...");
        transAmount = ethers.parseEther("1000000000");   // 1亿SHIM
        const treasuryBalanceBefore = await memeToken.balanceOf(treasury.address);
        console.log("转账前国库 banlance:", ethers.formatEther(treasuryBalanceBefore));
        const user2BalanceBefore = await memeToken.balanceOf(user2.address);
        console.log("转账前user2 banlance:", ethers.formatEther(user2BalanceBefore));
        tx = await memeToken.connect(user1).transfer(user2.address, transAmount);
        await tx.wait(3);

        user1Balance = await memeToken.balanceOf(user1.address);
        console.log("转账后user1 banlance:", ethers.formatEther(user1Balance));
        const user2BalanceAfter = await memeToken.balanceOf(user2.address);
        const user2BanlanceReceive = user2BalanceAfter - user2BalanceBefore;
        console.log("✅非免税地址转账，扣除收手续费，收到:", ethers.formatEther(user2BanlanceReceive));
        const taxReceived = transAmount - user2BanlanceReceive
        const transAmountFormatted = parseFloat(ethers.formatUnits(transAmount, 18));
        const taxReceivedFormatted = parseFloat(ethers.formatUnits(taxReceived, 18));
        const realTaxRate = taxReceivedFormatted / transAmountFormatted * 100;
        console.log("realTaxRate:", realTaxRate);
        expect(realTaxRate).to.be.closeTo(5, 0.01, "买入税率应在 5% ± 0.01% 范围内");

        const treasuryBalanceAfter = await memeToken.balanceOf(treasury.address);
        const treasuryBanlanceReceive = treasuryBalanceAfter - treasuryBalanceBefore;
        // 国库应收金额 转账 * 5% * 30%
        console.log("✅非免税地址转账，国库收到:", ethers.formatEther(treasuryBanlanceReceive));
        const expectTreasuryReceiveFormatted = transAmountFormatted * 5 / 100 * 30 / 100;
        const treasuryBanlanceReceiveFormatted = parseFloat(ethers.formatUnits(treasuryBanlanceReceive, 18));
        expect(expectTreasuryReceiveFormatted).to.be.closeTo(treasuryBanlanceReceiveFormatted, 1, "国库收到金额与预期不超过1");
    });

    // 验证测试通过
    it("验证使用ETH换取meme代币，有5%买入手续费", async function () {
        const buyEthAmount = ethers.parseEther("0.0000002"); // 用户1用 0.0000005 ETH 买入
        const path = [wethAddress, memeTokenAddress];
        const deadline = Math.floor(Date.now() / 1000) + 60 * 10; // 10分钟

        //用户1交易前，代币合约余额，用户代币余额，国库余额
        const contractBalanceBefore = await memeToken.balanceOf(memeTokenAddress);
        console.log("contractBalanceBefore:", ethers.formatEther(contractBalanceBefore));
        const userBalanceBefore = await memeToken.balanceOf(user1.address);
        console.log("userBalanceBefore:", ethers.formatEther(userBalanceBefore));
        const treasuryBalanceBefore = await memeToken.balanceOf(treasury.address);
        console.log("treasuryBalanceBefore:", ethers.formatEther(treasuryBalanceBefore));

        // 用户（user1）通过 Router 买入代币
        tx = await router.connect(user1).swapExactETHForTokens(
            0,
            path,
            user1.address,
            deadline,
            { value: buyEthAmount }
        );
        await tx.wait(3);
        console.log("第一次购买成功！");

        //等待 20 秒 (合约配置的交易间隔为20秒)
        // await sleep(20000);

        // //连续买两次
        // tx = await router.connect(user1).swapExactETHForTokens(
        //     0,
        //     path,
        //     user1.address,
        //     deadline,
        //     { value: buyEthAmount }
        // );
        // await tx.wait(3);
        // console.log("第二次购买成功！");

        //用户交易后，代币合约余额，用户代币余额，国库余额
        const contractBalanceAfter = await memeToken.balanceOf(await memeToken.getAddress());
        console.log("contractBalanceAfter:", ethers.formatEther(contractBalanceAfter));
        const userBalanceAfter = await memeToken.balanceOf(user1.address);
        console.log("userBalanceAfter:", ethers.formatEther(userBalanceAfter));
        const treasuryBalanceAfter = await memeToken.balanceOf(treasury.address);
        console.log("treasuryBalanceAfter:", ethers.formatEther(treasuryBalanceAfter));

        //合约收到的税费
        const taxReceived = contractBalanceAfter - contractBalanceBefore;
        console.log("\ntaxReceived:", ethers.formatEther(taxReceived));

        // 国库收到的税费
        const treasuryReceived = treasuryBalanceAfter - treasuryBalanceBefore;
        console.log("treasuryReceived:", ethers.formatEther(treasuryReceived));

        //用户1收到的代币数
        const userReceived = userBalanceAfter - userBalanceBefore;
        console.log("userReceived:", ethers.formatEther(userReceived));

        //验证合约收到的税费必须正好是 5%
        const taxReceivedFormatted = parseFloat(ethers.formatUnits(taxReceived, 18));
        const treasuryReceivedFormatted = parseFloat(ethers.formatUnits(treasuryReceived, 18));
        const userReceivedFormatted = parseFloat(ethers.formatUnits(userReceived, 18));

        const totalTax = taxReceivedFormatted + treasuryReceivedFormatted * 2;  // 合约收到40% + 国库和销毁的各30%
        console.log("收到的总税费:", totalTax);
        const totalDistributed = userReceivedFormatted + totalTax;
        const realTaxRate = (totalTax / totalDistributed) * 100;
        console.log("实际税费::", realTaxRate);
        expect(realTaxRate).to.be.closeTo(5, 0.01, "买入税率应在 5% ±0.01% 范围内");

        await getPairLiquidity();
    });

    // 测试验证通过
    it("验证用meme币兑换ETH，卖出手续费为10%", async function () {
        // 获取用户 ETH 余额（卖出前）
        const userETHBalanceBefore = await ethers.provider.getBalance(user1.address);
        console.log("\n用户1卖出前代币前ETH余额:", ethers.formatEther(userETHBalanceBefore), "ETH");

        //用户1交易前，代币合约余额，用户代币余额，国库余额
        const contractBalanceBefore = await memeToken.balanceOf(memeTokenAddress);
        console.log("contractBalanceBefore:", ethers.formatEther(contractBalanceBefore));
        const userBalanceBefore = await memeToken.balanceOf(user1.address);
        console.log("userBalanceBefore:", ethers.formatEther(userBalanceBefore));
        const treasuryBalanceBefore = await memeToken.balanceOf(treasury.address);
        console.log("treasuryBalanceBefore:", ethers.formatEther(treasuryBalanceBefore));

        let sellAmount = ethers.parseUnits("40000000", 18); // 用户卖出 40000000 个代币
        const pathSell = [memeTokenAddress, wethAddress];
        //预估卖出 50000000 meme币能换多少 ETH
        let amountsOut = await router.getAmountsOut(sellAmount, pathSell);
        let estimatedETH = amountsOut[1]; // 第二个是输出的 ETH 数量
        console.log("\n预计卖出可能ETH:", ethers.formatEther(estimatedETH));

        //设置最小输出为预估值的 99%（防止滑点，有10%手续费）
        let amountOutMin = (estimatedETH * 89n) / 100n;
        console.log("amountOutMin:", ethers.formatEther(amountOutMin));

        const deadline = Math.floor(Date.now() / 1000) + 60 * 10; // 10分钟
        // 用户（user1）授权 Router 使用其代币
        await memeToken.connect(user1).approve(routerAddress, sellAmount);
        // 用户（user1）通过 Router 卖出代币
        // 转账时扣税：swapExactTokensForETHSupportingFeeOnTransferTokens
        // 转账时不扣税：swapExactTokensForETH
        const txSell = await router.connect(user1).swapExactTokensForETHSupportingFeeOnTransferTokens(
            sellAmount,
            amountOutMin,
            pathSell,
            user1.address,
            deadline
        );
        await txSell.wait(3);
        console.log("卖出成功！");

        // 用户卖出后用户代币余额、合约、国库代币余额
        const userBalanceAfter = await memeToken.balanceOf(user1.address);
        console.log("\nuserBalanceAfter:", ethers.formatUnits(userBalanceAfter, 18));
        const contractBalanceAfter = await memeToken.balanceOf(memeTokenAddress);
        console.log("contractBalanceAfter:", ethers.formatUnits(contractBalanceAfter, 18));
        const treasuryBalanceAfter = await memeToken.balanceOf(treasury.address);
        console.log("treasuryBalanceAfter:", ethers.formatUnits(treasuryBalanceAfter, 18));

        // 实际收到的税费
        const contractReceived = contractBalanceAfter - contractBalanceBefore;
        const treasuryReceived = treasuryBalanceAfter - treasuryBalanceBefore;
        const taxReceivedFormatted = parseFloat(ethers.formatUnits(contractReceived, 18));
        const treasuryReceivedFormatted = parseFloat(ethers.formatUnits(treasuryReceived, 18));

        const totalTax = taxReceivedFormatted + treasuryReceivedFormatted * 2;  // 合约收到40% + 国库和销毁的各30%
        console.log("收到的总税费:", totalTax);
        const sellAmountInEther = parseFloat(ethers.formatUnits(sellAmount, 18));
        const realTaxRate = (totalTax / sellAmountInEther) * 100;
        expect(realTaxRate).to.be.closeTo(10, 0.01, "卖出税率应该在 10% ±0.01% 范围内");

        // 获取用户 ETH 余额（卖出后）
        const userETHBalanceAfter = await ethers.provider.getBalance(user1.address);
        console.log("\n用户卖出代币后，ETH余额:", ethers.formatEther(userETHBalanceAfter), "ETH");

        // 计算用户收到的 ETH 数量
        const ethReceived = userETHBalanceAfter - userETHBalanceBefore;
        console.log("用户收到的ETH金额:", ethers.formatEther(ethReceived), "ETH");

        //获取交易后的 pair 余额
        await getPairLiquidity();
    });

    it("查询交易币对中，meme币和WETH的流动性余额", async function () {
        await getPairLiquidity();
    });

    //辅助函数，获取指定交易对中 LMEME 和 WETH 的流动性余额
    async function getPairLiquidity() {
        const IUniswapV2Pair = [
            "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
            "function token0() external view returns (address)",
            "function token1() external view returns (address)"
        ];

        const provider = ethers.provider;
        const pair = new ethers.Contract(pairAddress, IUniswapV2Pair, provider);

        // 获取 reserves
        const reserves = await pair.getReserves();
        const reserve0 = reserves[0];
        const reserve1 = reserves[1];

        // 获取 token0 和 token1
        const token0 = await pair.token0();
        const token1 = await pair.token1();

        //判断哪个是 MemeToken，哪个是 WETH
        //let memeInPair, wethInPair;
        if (token0.toLowerCase() === memeTokenAddress.toLowerCase()) {
            memeInPair = reserve0;
            wethInPair = reserve1;
        } else if (token1.toLowerCase() === memetokenAddress.toLowerCase()) {
            memeInPair = reserve1;
            wethInPair = reserve0;
        } else {
            throw new Error("Pair does not contain MemeToken");
        }
        console.log("\nETH (as WETH) in Pair:", ethers.formatEther(wethInPair), "WETH");
        console.log("MEME in Pair:", ethers.formatUnits(memeInPair, 18), "SHIM");
    };

});